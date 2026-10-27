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
    Artwork(Context context){root=new File(context.getFilesDir(),"images");}
    private File resolve(String path){return path.matches("(?:poster|backdrop)/[a-f0-9]{64}\\.img")?new File(root,path):null;}
    private String store(String address,String kind) throws Exception {
        URL url=new URL(address);if(!url.getProtocol().equals("https")||!url.getHost().equals("image.tmdb.org")||url.getPort()!=-1)throw new IllegalArgumentException("图片地址无效。");
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(address.getBytes(java.nio.charset.StandardCharsets.UTF_8));StringBuilder hash=new StringBuilder();for(byte value:digest)hash.append(String.format(java.util.Locale.US,"%02x",value&255));
        String relative=kind+"/"+hash+".img";File file=resolve(relative);if(file.isFile())return relative;
        HttpsURLConnection connection=(HttpsURLConnection)url.openConnection();byte[] bytes;
        try{connection.setConnectTimeout(12000);connection.setReadTimeout(12000);connection.setInstanceFollowRedirects(false);if(connection.getResponseCode()!=200)throw new java.io.IOException();bytes=TmdbClient.read(connection.getInputStream(),12*1024*1024);}finally{connection.disconnect();}
        BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);
        if(bounds.outWidth<=0||bounds.outHeight<=0||bounds.outWidth>10000||bounds.outHeight>10000)throw new IllegalArgumentException("图片格式无效。");
        File parent=file.getParentFile();if(!parent.isDirectory()&&!parent.mkdirs())throw new java.io.IOException();
        File temporary=File.createTempFile("art-",".tmp",parent);try{try(FileOutputStream output=new FileOutputStream(temporary)){output.write(bytes);}if(!temporary.renameTo(file))throw new java.io.IOException();}finally{temporary.delete();}return relative;
    }
    JSONObject cacheMetadata(JSONObject candidate,JSONObject previous){
        JSONObject result=Json.copy(candidate);
        for(String kind:new String[]{"poster","backdrop"}){
            String url=Json.text(candidate,kind+"Url"),old=previous==null?"":Json.text(previous,kind+"Path");
            String path=null;if(!url.isEmpty()){try{path=store(url,kind);}catch(Exception ignored){path=old.isEmpty()?null:old;}}
            else if(previous!=null&&!(kind.equals("backdrop")&&Json.text(candidate,"externalId").contains(":season:")))path=old.isEmpty()?null:old;
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
    void background(ImageView view,JSONObject film){String path=Json.text(film,"backdropPath");if(path.isEmpty())path=Json.text(film,"posterPath");load(view,path,960,540);}
    void preview(ImageView view,String address,int width,int height){
        view.setImageDrawable(null);String key="preview:"+address;view.setTag(key);if(closed||address.isEmpty())return;
        workers.execute(()->{if(closed||!key.equals(view.getTag()))return;try{String path=store(address,"poster");main.post(()->{if(!closed&&key.equals(view.getTag()))load(view,path,width,height);});}catch(Exception ignored){}});
    }
    void close(){closed=true;workers.shutdownNow();main.removeCallbacksAndMessages(null);bitmaps.evictAll();}
}
