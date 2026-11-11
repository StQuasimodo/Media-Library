package io.mycinema.tv;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.widget.ImageView;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

/** Bounded bitmap memory and background decoding for 1 GB-era televisions. */
final class Artwork {
    private final File root;
    private final ExecutorService workers=Executors.newFixedThreadPool(2);
    private final Handler main=new Handler(Looper.getMainLooper());
    private final LruCache<String,Bitmap> bitmaps=new LruCache<String,Bitmap>(8*1024*1024){@Override protected int sizeOf(String key,Bitmap value){return value.getAllocationByteCount();}};
    private volatile boolean closed;
    interface TransientTransport {byte[] read(URL address) throws Exception;}
    private final TransientTransport transientTransport;
    Artwork(Context context){this(context,Artwork::readTransient);}
    Artwork(Context context,TransientTransport transport){root=new File(context.getFilesDir(),"images");transientTransport=transport;}
    private static byte[] readTransient(URL url) throws Exception {HttpsURLConnection connection=(HttpsURLConnection)url.openConnection();try{connection.setUseCaches(false);connection.setRequestProperty("Cache-Control","no-store");connection.setConnectTimeout(12000);connection.setReadTimeout(12000);connection.setInstanceFollowRedirects(false);if(connection.getResponseCode()!=200)throw new java.io.IOException();return TmdbClient.read(connection.getInputStream(),8*1024*1024);}finally{connection.disconnect();}}

    private File resolve(String path){return path.matches("(?:poster|backdrop)/(?:[a-f0-9]{64}|manual/[A-Za-z0-9_-]{1,180}\\.(?:jpg|png|webp)|season/[0-9]+-[0-9]+/[a-f0-9]{64})\\.img")?new File(root,path):null;}
    private String store(String address,String kind) throws Exception {return store(address,kind,false);}
    String storeManual(String address,String kind) throws Exception {return store(address,kind,true);}
    private String manualUrl(String path,String kind){String prefix=kind+"/manual/";return path.startsWith(prefix)&&resolve(path)!=null?"https://image.tmdb.org/t/p/"+(kind.equals("poster")?"w780":"w1280")+"/"+path.substring(prefix.length(),path.length()-4):null;}
    private String store(String address,String kind,boolean manual) throws Exception {
        URL url=new URL(address);if(!url.getProtocol().equals("https")||!url.getHost().equals("image.tmdb.org")||url.getPort()!=-1)throw new IllegalArgumentException("图片地址无效。");
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(address.getBytes(java.nio.charset.StandardCharsets.UTF_8));StringBuilder hash=new StringBuilder();for(byte value:digest)hash.append(String.format(java.util.Locale.US,"%02x",value&255));
        String filename=url.getPath().substring(url.getPath().lastIndexOf('/')+1);if(manual&&!filename.matches("[A-Za-z0-9_-]{1,180}\\.(jpg|png|webp)"))throw new IllegalArgumentException("图片标识无效。");
        String relative=kind+"/"+(manual?"manual/"+filename:hash.toString())+".img";File file=resolve(relative);if(file.isFile())return relative;
        HttpsURLConnection connection=(HttpsURLConnection)url.openConnection();byte[] bytes;
        try{connection.setConnectTimeout(12000);connection.setReadTimeout(12000);connection.setInstanceFollowRedirects(false);if(connection.getResponseCode()!=200)throw new java.io.IOException();bytes=TmdbClient.read(connection.getInputStream(),12*1024*1024);}finally{connection.disconnect();}
        BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);
        if(bounds.outWidth<=0||bounds.outHeight<=0||bounds.outWidth>10000||bounds.outHeight>10000)throw new IllegalArgumentException("图片格式无效。");
        File parent=file.getParentFile();if(!parent.isDirectory()&&!parent.mkdirs())throw new java.io.IOException();
        File temporary=File.createTempFile("art-",".tmp",parent);try{try(FileOutputStream output=new FileOutputStream(temporary)){output.write(bytes);}if(!temporary.renameTo(file))throw new java.io.IOException();}finally{temporary.delete();}return relative;
    }
    private String scoped(String path,String external) throws Exception {
        if(!external.matches("[0-9]+:season:[0-9]+"))return path;String[] id=external.split(":");String relative="backdrop/season/"+id[0]+"-"+id[2]+"/"+path.substring(path.lastIndexOf('/')+1);File target=resolve(relative);if(target.isFile())return relative;File parent=target.getParentFile();if(!parent.isDirectory()&&!parent.mkdirs())throw new java.io.IOException();File temporary=File.createTempFile("scope-",".tmp",parent);try{try(java.io.InputStream input=new java.io.FileInputStream(resolve(path));FileOutputStream output=new FileOutputStream(temporary)){byte[] buffer=new byte[32768];for(int n;(n=input.read(buffer))!=-1;)output.write(buffer,0,n);}if(!temporary.renameTo(target))throw new java.io.IOException();}finally{temporary.delete();}return relative;
    }
    JSONObject cacheMetadata(JSONObject candidate,JSONObject previous){
        JSONObject result=Json.copy(candidate);
        for(String kind:new String[]{"poster","backdrop"}){
            String url=Json.text(candidate,kind+"Url"),old=previous==null?"":Json.text(previous,kind+"Path");
            String locked=manualUrl(old,kind);String path=null;if(locked!=null){try{path=store(locked,kind,true);}catch(Exception ignored){path=old;}}else if(!url.isEmpty()){try{path=store(url,kind);if(kind.equals("backdrop"))path=scoped(path,Json.text(candidate,"externalId"));}catch(Exception ignored){path=old.isEmpty()?null:old;}}
            else if(previous!=null){
                String selection=Json.text(candidate,kind+"Selection");
                boolean clear=selection.equals("resolved")||(selection.isEmpty()&&kind.equals("backdrop")&&Json.text(candidate,"externalId").contains(":season:"));
                if(!clear)path=old.isEmpty()?null:old;
            }
            Json.put(result,kind+"Path",path);
        }return result;
    }
    void load(ImageView target,String path,int width,int height){
        String key=path+":"+width+":"+height;target.setTag(key);target.setImageDrawable(null);
        if(closed||path.isEmpty())return;Bitmap cached=bitmaps.get(key);if(cached!=null){target.setImageBitmap(cached);return;}
        workers.execute(()->{
            if(closed||!key.equals(target.getTag()))return;File file=resolve(path);if(file==null||!file.isFile())return;
            BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeFile(file.getPath(),options);
            options.inSampleSize=1;while(options.outWidth/options.inSampleSize>width*2||options.outHeight/options.inSampleSize>height*2)options.inSampleSize*=2;
            options.inJustDecodeBounds=false;options.inPreferredConfig=Bitmap.Config.RGB_565;Bitmap bitmap=BitmapFactory.decodeFile(file.getPath(),options);
            if(bitmap==null)return;if(closed){bitmap.recycle();return;}bitmaps.put(key,bitmap);
            main.post(()->{if(!closed&&key.equals(target.getTag()))target.setImageBitmap(bitmap);});
        });
    }
    void background(ImageView view,JSONObject film){String path=Json.text(film,"backdropPath"),external=Json.text(film,"externalId");if(external.matches("[0-9]+:season:[0-9]+")){String[] id=external.split(":");if(!path.startsWith("backdrop/manual/")&&!path.startsWith("backdrop/season/"+id[0]+"-"+id[2]+"/"))path="";}boolean fallback=path.isEmpty();if(fallback)path=Json.text(film,"posterPath");view.setAlpha(fallback?.24f:1f);load(view,path,960,540);}
    void preview(ImageView view,String address,int width,int height){
        view.setImageDrawable(null);String key="preview:"+address;view.setTag(key);if(closed||address.isEmpty())return;
        workers.execute(()->{if(closed||!key.equals(view.getTag()))return;try{String path=store(address,"poster");main.post(()->{if(!closed&&key.equals(view.getTag()))load(view,path,width,height);});}catch(Exception ignored){}});
    }
    void transientImage(ImageView view,String address,int width,int height){
        final String key="transient:"+address+System.nanoTime();view.setTag(key);view.setImageDrawable(null);if(closed)return;
        workers.execute(()->{Bitmap bitmap=null;try{
            URL url=new URL(address);if(!url.getProtocol().equals("https")||!url.getHost().equals("image.tmdb.org")||url.getPort()!=-1)throw new java.io.IOException();
            byte[] bytes=transientTransport.read(url);if(bytes.length>8*1024*1024)throw new java.io.IOException();
            BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);if(options.outWidth<=0||options.outHeight<=0||options.outWidth>10000||options.outHeight>10000)return;
            options.inSampleSize=1;while(options.outWidth/options.inSampleSize>width*2||options.outHeight/options.inSampleSize>height*2)options.inSampleSize*=2;options.inJustDecodeBounds=false;options.inPreferredConfig=Bitmap.Config.RGB_565;bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
            final Bitmap ready=bitmap;main.post(()->{if(ready==null)return;if(!closed&&key.equals(view.getTag()))view.setImageBitmap(ready);else ready.recycle();});
        }catch(Exception ignored){if(bitmap!=null)bitmap.recycle();}});
    }
    void close(){closed=true;workers.shutdownNow();main.removeCallbacksAndMessages(null);bitmaps.evictAll();}
}
