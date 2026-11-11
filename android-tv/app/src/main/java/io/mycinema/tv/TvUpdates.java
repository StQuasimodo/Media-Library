package io.mycinema.tv;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.cert.CertificateFactory;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONObject;

/** A mirror supplies bytes, never trust. The bundled certificate authenticates the manifest. */
final class TvUpdates implements AutoCloseable {
    private static final String DOMAIN="MY_CINEMA_UPDATE_V1\n";
    private static final OkHttpClient HTTP=new OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES).connectTimeout(12,TimeUnit.SECONDS).readTimeout(30,TimeUnit.SECONDS).callTimeout(5,TimeUnit.MINUTES).build();
    private final Context context;private final SharedPreferences prefs;private final String channel;
    private volatile Call active;private volatile boolean closed;private volatile JSONObject manifest;private final java.util.concurrent.ExecutorService checks=java.util.concurrent.Executors.newSingleThreadExecutor();
    TvUpdates(Context context){this.context=context.getApplicationContext();prefs=context.getSharedPreferences("app-updates",Context.MODE_PRIVATE);channel=BuildConfig.VERSION_NAME.contains("-")?"preview":"stable";
        try{String pending=prefs.getString("pending","");if(!pending.isEmpty()){JSONObject saved=verify(pending,channel,certificate());if(saved.optInt("versionCode")>context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionCode&&saved.optInt("minSdk",Integer.MAX_VALUE)<=Build.VERSION.SDK_INT)manifest=saved;}}catch(Exception ignored){}
    }
    private String certificate() throws Exception {try(InputStream input=context.getAssets().open("update-signing.json")){return new JSONObject(new String(TmdbClient.read(input,16384),StandardCharsets.UTF_8)).getString("certificatePem");}}
    File cached(){if(manifest==null)return null;File file=new File(new File(context.getFilesDir(),"updates"),manifest.optJSONObject("asset").optString("sha256")+".apk");return file.isFile()?file:null;}
    interface Ready {void result(JSONObject value);}
    void background(Ready ready){if(!closed)checks.execute(()->{try{ready.result(check());}catch(Exception ignored){}});}
    boolean automatic(){return prefs.getBoolean("automatic",true);}
    boolean due(){return automatic()&&System.currentTimeMillis()-prefs.getLong("lastCheck",0)>12*60*60*1000L;}
    String mirror(){return prefs.getString("mirror","auto");}
    void automatic(boolean value){prefs.edit().putBoolean("automatic",value).apply();}
    static String validateMirror(String value){String text=value.trim();if(text.isEmpty()||text.equals("auto"))return text;HttpUrl url=HttpUrl.parse(text.replace("{url}","placeholder"));if(text.length()>2048||url==null||!url.isHttps()||!url.username().isEmpty()||!url.password().isEmpty()||url.fragment()!=null||text.indexOf("{url}")!=text.lastIndexOf("{url}"))throw new IllegalArgumentException("镜像须为不含账号的HTTPS地址，可使用{url}占位符。");return text.contains("{url}")?text:text.replaceAll("/*$","")+"/";}
    void mirror(String value){prefs.edit().putString("mirror",validateMirror(value)).putLong("lastCheck",0).apply();}
    static org.json.JSONArray mirrorPresets(Context context){try(InputStream input=context.getAssets().open("update-mirrors.json")){return new org.json.JSONArray(new String(TmdbClient.read(input,16384),StandardCharsets.UTF_8));}catch(Exception ignored){return new org.json.JSONArray();}}
    private List<String> sources(String original) throws Exception {List<String> list=new ArrayList<>();list.add(original);String selected=validateMirror(mirror());if(selected.equals("auto")){org.json.JSONArray presets=mirrorPresets(context);for(int i=0;i<Math.min(3,presets.length());i++)appendMirror(list,original,validateMirror(presets.getJSONObject(i).getString("url")));}else if(!selected.isEmpty())appendMirror(list,original,selected);return list;}
    private static void appendMirror(List<String> list,String original,String mirror) throws Exception {list.add(mirror.contains("{url}")?mirror.replace("{url}",URLEncoder.encode(original,"UTF-8")):mirror+original);}
    private Response response(String address) throws Exception {return response(address,false);}
    private Response response(String address,boolean download) throws Exception {
        if(closed||Thread.currentThread().isInterrupted())throw new java.io.IOException();HttpUrl url=HttpUrl.parse(address);if(url==null||!url.isHttps()||!url.username().isEmpty()||!url.password().isEmpty())throw new java.io.IOException();
        active=HTTP.newCall(new Request.Builder().url(url).header("Cache-Control","no-store").build());active.timeout().timeout(download?300000:12000,TimeUnit.MILLISECONDS);Response response=active.execute();if(!response.isSuccessful()||response.body()==null||!response.request().url().isHttps()){response.close();throw new java.io.IOException();}return response;
    }
    static JSONObject verify(String envelope,String expectedChannel,String certificate) throws Exception {
        if(envelope.length()>65536)throw new IllegalArgumentException("更新说明过大。");JSONObject signed=new JSONObject(envelope);String body=signed.optString("payload"),encoded=signed.optString("signature");if(body.length()>49152||encoded.length()>8192||body.isEmpty()||encoded.isEmpty())throw new IllegalArgumentException("更新说明无效。");
        byte[] bytes=Base64.decode(body,Base64.DEFAULT),signature=Base64.decode(encoded,Base64.DEFAULT);Signature verifier=Signature.getInstance("SHA256withRSA");verifier.initVerify(CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(certificate.getBytes(StandardCharsets.US_ASCII))).getPublicKey());verifier.update(DOMAIN.getBytes(StandardCharsets.UTF_8));verifier.update(bytes);if(!verifier.verify(signature))throw new IllegalArgumentException("更新签名校验失败，已拒绝更新。");
        JSONObject result=new JSONObject(new String(bytes,StandardCharsets.UTF_8));String version=Json.text(result,"version");if(result.optInt("format")!=1||!Json.text(result,"platform").equals("tv")||!Json.text(result,"channel").equals(expectedChannel)||!version.matches("[0-9]+\\.[0-9]+\\.[0-9]+(?:-(?:alpha|beta|rc)\\.[0-9]+)?")||result.optInt("versionCode",-1)<0)throw new IllegalArgumentException("更新渠道或版本无效。");
        JSONObject asset=result.optJSONObject("asset");if(asset==null||!Json.text(asset,"sha256").matches("[a-f0-9]{64}")||asset.optLong("bytes",0)<=0||asset.optLong("bytes")>2L*1024*1024*1024)throw new IllegalArgumentException("更新文件信息无效。");
        String name=Json.text(asset,"name"),tag="tv-v"+version,base="https://github.com/StQuasimodo/Media-Library/releases/";if(!name.matches("My-Cinema-TV-[a-zA-Z0-9.-]+\\.apk")||!Json.text(asset,"url").equals(base+"download/"+tag+"/"+name)||!Json.text(result,"releaseUrl").equals(base+"tag/"+tag))throw new IllegalArgumentException("更新文件来源无效。");return result;
    }
    JSONObject check() throws Exception {
        prefs.edit().putLong("lastCheck",System.currentTimeMillis()).apply();String certificate=certificate();
        String endpoint="https://raw.githubusercontent.com/StQuasimodo/Media-Library/main/updates/tv-"+channel+".json";Exception failure=null;
        for(String source:sources(endpoint))try(Response response=response(source)){String envelope=new String(TmdbClient.read(response.body().byteStream(),65536),StandardCharsets.UTF_8);JSONObject candidate=verify(envelope,channel,certificate);if(candidate.optInt("minSdk",Integer.MAX_VALUE)>Build.VERSION.SDK_INT)throw new IllegalArgumentException("新版本需要更高的Android系统，当前版本保留。");
            manifest=candidate.optInt("versionCode")>context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionCode?candidate:null;prefs.edit().putString("pending",manifest==null?"":envelope).apply();return manifest;
        }catch(Exception error){failure=error;}
        throw new IllegalStateException(failure instanceof IllegalArgumentException?failure.getMessage():"更新服务暂不可用，请检查网络或配置镜像。");
    }
    interface Progress {void changed(long done,long total);}
    File download(Progress progress) throws Exception {
        if(manifest==null)throw new IllegalStateException("请先检查更新。");JSONObject asset=manifest.getJSONObject("asset");String hash=asset.getString("sha256");long size=asset.getLong("bytes");File directory=new File(context.getFilesDir(),"updates");if(!directory.isDirectory()&&!directory.mkdirs())throw new java.io.IOException();File file=new File(directory,hash+".apk"),temporary=new File(directory,hash+".part");
        if(file.isFile())try{installer(file);return file;}catch(Exception ignored){file.delete();}
        for(String source:sources(asset.getString("url")))try(Response response=response(source,true)){
            MessageDigest digest=MessageDigest.getInstance("SHA-256");long count=0;try(InputStream input=response.body().byteStream();FileOutputStream output=new FileOutputStream(temporary)){byte[] buffer=new byte[65536];for(int n;(n=input.read(buffer))!=-1;){if(closed||Thread.currentThread().isInterrupted())throw new java.io.IOException();count+=n;if(count>size)throw new IllegalArgumentException("更新包大小不符。");digest.update(buffer,0,n);output.write(buffer,0,n);progress.changed(count,size);}output.getFD().sync();}
            if(count!=size||!hex(digest.digest()).equals(hash))throw new IllegalArgumentException("更新包校验失败，已拒绝安装。");validatePackage(temporary);if(file.exists()&&!file.delete())throw new java.io.IOException();if(!temporary.renameTo(file))throw new java.io.IOException();return file;
        }catch(Exception error){temporary.delete();}
        throw new IllegalStateException("更新包下载或校验失败，请检查镜像和网络。");
    }
    @SuppressWarnings("deprecation") private void validatePackage(File file) throws Exception {
        PackageManager pm=context.getPackageManager();PackageInfo candidate=pm.getPackageArchiveInfo(file.getPath(),PackageManager.GET_SIGNATURES),current=pm.getPackageInfo(context.getPackageName(),PackageManager.GET_SIGNATURES);
        if(candidate==null||!context.getPackageName().equals(candidate.packageName)||candidate.versionCode!=manifest.optInt("versionCode")||!manifest.optString("version").equals(candidate.versionName)||candidate.signatures==null||candidate.signatures.length!=1||current.signatures==null||current.signatures.length!=1||!candidate.signatures[0].equals(current.signatures[0]))throw new IllegalArgumentException("安装包应用身份或签名不符，已拒绝安装。");
    }
    Intent installer(File file) throws Exception {
        if(manifest==null||file.length()!=manifest.getJSONObject("asset").getLong("bytes"))throw new IllegalStateException("请重新下载更新包。");MessageDigest hash=MessageDigest.getInstance("SHA-256");try(InputStream input=new FileInputStream(file)){byte[] buffer=new byte[65536];for(int n;(n=input.read(buffer))!=-1;)hash.update(buffer,0,n);}if(!hex(hash.digest()).equals(manifest.getJSONObject("asset").getString("sha256")))throw new IllegalStateException("文件已变化，已拒绝安装。");validatePackage(file);
        return new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse("content://"+context.getPackageName()+".updates/package/"+file.getName()),"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    }
    static String hex(byte[] bytes){StringBuilder value=new StringBuilder();for(byte b:bytes)value.append(String.format(java.util.Locale.US,"%02x",b&255));return value.toString();}
    @Override public void close(){closed=true;checks.shutdownNow();Call call=active;if(call!=null)call.cancel();}
}
