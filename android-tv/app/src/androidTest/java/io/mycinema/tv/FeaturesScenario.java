package io.mycinema.tv;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** Actual API22 tests, separate APK; fixtures never run on a user's television. */
final class FeaturesScenario {
    private final Instrumentation test;private Context context;private final List<String> checks=new ArrayList<>();
    FeaturesScenario(Instrumentation test){this.test=test;}
    private void check(boolean value,String label){if(!value)throw new AssertionError(label);checks.add(label);}
    private String read(File file)throws Exception{try(InputStream input=new FileInputStream(file)){return new String(TmdbClient.read(input,4*1024*1024),StandardCharsets.UTF_8);}}
    private JSONObject film(String title,String id,String type,String series,int order){JSONObject value=new JSONObject();Json.put(value,"title",title);Json.put(value,"externalId",id);Json.put(value,"mediaType",type);Json.put(value,"metadataSource","tmdb");Json.put(value,"series",TmdbClient.series(series,title,order));return value;}
    private View label(View view,String text){if(view instanceof TextView&&((TextView)view).getText().toString().equals(text))return view;if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){View found=label(((ViewGroup)view).getChildAt(i),text);if(found!=null)return found;}return null;}
    private static int files(File dir){File[] list=dir.listFiles();int count=0;if(list!=null)for(File file:list)count+=file.isDirectory()?files(file):1;return count;}
    private void upgrade()throws Exception{
        check(context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionCode==BuildConfig.VERSION_CODE&&BuildConfig.VERSION_CODE>8,"actual same-signer published code8 to current version upgrade");
        JSONObject before=Json.object(read(new File(context.getFilesDir(),"upgrade-baseline.json"))),after=new TvBackup(context).snapshot();before.remove("createdAt");after.remove("createdAt");
        check(canonical(before).equals(canonical(after)),"all collection, association and progress backup data preserved byte-for-value");
        check(new SecretStore(context).read().equals("upgrade-metadata-fixture"),"Android Keystore TMDB credential survives APK replacement");
        check(new SecretStore(context,"quark","夸克").read().equals("__puus=upgrade-account-fixture"),"encrypted Quark account survives APK replacement");
        check(new SecretStore(context,"webdav","WebDAV").read().equals("upgrade-webdav-fixture"),"encrypted WebDAV credential survives APK replacement");
        QuarkDavManager dav=new QuarkDavManager(context);check(dav.enabled()&&dav.rootId().equals("saved-folder"),"chosen Quark folder survives APK replacement");
        try(MediaCatalog catalog=new MediaCatalog(context)){JSONObject entry=catalog.get("quark:upgrade-preserved-file");check(entry!=null&&entry.optBoolean("associationManual")&&catalog.position("quark:upgrade-preserved-file")==45123,"manual match and exact playback position preserved");}
    }
    private static String canonical(Object value)throws Exception{if(value instanceof JSONObject){JSONObject object=(JSONObject)value;List<String> keys=new ArrayList<>();for(Iterator<String> it=object.keys();it.hasNext();)keys.add(it.next());Collections.sort(keys);StringBuilder out=new StringBuilder("{");for(String key:keys)out.append(JSONObject.quote(key)).append(':').append(canonical(object.get(key))).append(',');return out.append('}').toString();}if(value instanceof JSONArray){StringBuilder out=new StringBuilder("[");for(int i=0;i<((JSONArray)value).length();i++)out.append(canonical(((JSONArray)value).get(i))).append(',');return out.append(']').toString();}return String.valueOf(value);}
    private void allocationAndRelations()throws Exception{
        JSONArray images=new JSONArray();for(String name:new String[]{"d","b","a","c"}){JSONObject image=new JSONObject();Json.put(image,"file_path","/"+name+".jpg");Json.put(image,"iso_639_1","en");Json.put(image,"width",1920);Json.put(image,"height",1080);Json.put(image,"vote_average",7);Json.put(image,"vote_count",30);images.put(image);}
        for(int n=1;n<=4;n++)check(ArtworkPolicy.seriesBackdrop(images,n).equals("/"+(char)('a'+n-1)+".jpg"),"stable distinct gallery allocation for season "+n);
        check(ArtworkPolicy.seriesBackdrop(images,0).equals("/d.jpg"),"specials use the last eligible image rather than always duplicating season one");
        JSONObject strong=Json.copy(images.getJSONObject(0));Json.put(strong,"file_path","/strong.jpg");Json.put(strong,"vote_average",8);Json.put(strong,"vote_count",100);JSONObject weak=Json.copy(strong);Json.put(weak,"file_path","/weak.jpg");Json.put(weak,"vote_average",4);
        check(ArtworkPolicy.seriesBackdrop(new JSONArray().put(strong).put(weak),2).equals("/strong.jpg"),"quality floor prevents low quality art merely for uniqueness");
        FranchiseFolders folders=new FranchiseFolders(context);Library.Item original=new Library.Item(film("神偷奶爸","20352","movie","tmdb:collection:86066",1),new JSONObject()),spinoff=new Library.Item(film("小黄人大眼萌","211672","movie","tmdb:collection:544669",1),new JSONObject());
        check(folders.key(original).equals("universe:despicable-me")&&folders.key(original).equals(folders.key(spinoff)),"original and spin-off collections use explicit collection-ID relation");
        Library.Item unrelated=new Library.Item(film("神偷奶爸2","999999","movie","tmdb:collection:999999",1),new JSONObject());check(folders.universe(unrelated)==null,"similar title does not invent a spin-off relation");Json.put(spinoff.film.getJSONObject("series"),"franchise",null);check(folders.universe(spinoff)==null,"manual exclusion overrides collection relation");
    }
    private void features()throws Exception{
        allocationAndRelations();
        String envelope,cert;try(InputStream input=test.getContext().getAssets().open("tv-preview.json")){envelope=new String(TmdbClient.read(input,65536),StandardCharsets.UTF_8);}try(InputStream input=context.getAssets().open("update-signing.json")){cert=Json.object(new String(TmdbClient.read(input,16384),StandardCharsets.UTF_8)).getString("certificatePem");}
        check(TvUpdates.verify(envelope,"preview",cert).getString("platform").equals("tv"),"real released feed signature verifies with bundled certificate on API22");
        JSONObject altered=Json.object(envelope);String payload=altered.getString("payload");Json.put(altered,"payload",(payload.charAt(0)=='A'?"B":"A")+payload.substring(1));boolean denied=false;try{TvUpdates.verify(altered.toString(),"preview",cert);}catch(Exception expected){denied=true;}check(denied,"tampered signed feed rejected");
        denied=false;try{TvUpdates.verify(envelope,"stable",cert);}catch(Exception expected){denied=true;}check(denied,"cross-channel feed rejected");
        for(String bad:new String[]{"http://mirror.example/","https://user:pass@mirror.example/","https://mirror.example/#fragment","https://mirror.example/{url}/{url}"}){denied=false;try{TvUpdates.validateMirror(bad);}catch(Exception expected){denied=true;}check(denied,"invalid update mirror rejected: "+bad.replace("user:pass@",""));}
        check(TvUpdates.validateMirror("https://mirror.example/").equals("https://mirror.example/")&&TvUpdates.validateMirror("https://mirror.example/?url={url}").contains("{url}"),"configurable HTTPS mirror accepts prefix and encoded template");
        JSONObject preserved;try(Library previous=new Library(context)){preserved=previous.snapshot();}
        List<String> owned=new ArrayList<>();try(Library library=new Library(context)){
            Library.Item a=library.saveCandidate(film("绝命毒师 测试第一季","1396:season:1","tv","tmdb:tv:1396",1)),b=library.saveCandidate(film("风骚律师 测试第一季","60059:season:1","tv","tmdb:tv:60059",1)),c=library.saveCandidate(film("续命之徒 测试","559969","movie","tmdb:movie:559969",1));for(Library.Item item:Arrays.asList(a,b,c))owned.add(item.id());
            FranchiseFolders folders=new FranchiseFolders(context);check(folders.groups(Arrays.asList(a,b,c)).size()==1,"related TV and spin-off film share explicit universe folder");String original=a.seriesKey();library.assignFranchise(owned,"franchise:manual:test","测试收藏宇宙");check(library.get(a.id()).seriesKey().equals(original),"manual universe assignment preserves canonical series and season order");library.refresh(a.id(),film(a.title(),"1396:season:1","tv","tmdb:tv:1396",1));check(folders.key(library.get(a.id())).equals("franchise:manual:test"),"manual folder survives TMDB metadata refresh");library.clearFranchise(Collections.singletonList(a.id()));check(folders.key(library.get(a.id())).equals(original),"remove universe retains canonical TV series");
            Artwork art=new Artwork(context);JSONObject locked=new JSONObject();Json.put(locked,"posterPath","poster/manual/missing.jpg.img");Json.put(locked,"backdropPath","backdrop/manual/missing.jpg.img");JSONObject unavailable=new JSONObject();Json.put(unavailable,"posterSelection","unavailable");Json.put(unavailable,"backdropSelection","unavailable");JSONObject kept=art.cacheMetadata(unavailable,locked);check(Json.text(kept,"posterPath").equals(Json.text(locked,"posterPath"))&&Json.text(kept,"backdropPath").equals(Json.text(locked,"backdropPath")),"manual artwork lock retained when network unavailable");art.close();
            // Verify legacy season background is suppressed immediately, before online refresh.
            final ImageView[] image={null};final Artwork fallback=new Artwork(context);test.runOnMainSync(()->{image[0]=new ImageView(context);JSONObject wrong=new JSONObject();Json.put(wrong,"externalId","1396:season:2");Json.put(wrong,"posterPath","poster/manual/test.jpg.img");Json.put(wrong,"backdropPath","backdrop/"+"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"+".img");fallback.background(image[0],wrong);});check(image[0].getDrawable()==null&&image[0].getTag().equals(":960:540"),"missing or legacy background never loads a portrait poster");fallback.close();
            JSONObject inherited=new JSONObject();Json.put(inherited,"externalId","1396:season:2");Json.put(inherited,"backdropPath","backdrop/series/1396/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.img");check(Artwork.backgroundPath(inherited).startsWith("backdrop/series/1396/"),"explicit series fallback accepted for its own seasons");Json.put(inherited,"externalId","60059:season:1");check(Artwork.backgroundPath(inherited).isEmpty(),"series fallback rejected for another show");
            // In-memory byte transport exercises actual Android bitmap decode and UI, without disk writes.
            Bitmap bitmap=Bitmap.createBitmap(32,18,Bitmap.Config.RGB_565);bitmap.eraseColor(0xff4488cc);ByteArrayOutputStream bytes=new ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.PNG,100,bytes);bitmap.recycle();int before=files(new File(context.getFilesDir(),"images"));final Artwork still=new Artwork(context,url->bytes.toByteArray());test.runOnMainSync(()->still.transientImage(image[0],"https://image.tmdb.org/t/p/w780/test.jpg",160,90));for(int i=0;i<40&&image[0].getDrawable()==null;i++){test.waitForIdleSync();Thread.sleep(50);}check(image[0].getDrawable()!=null,"online still rendered using actual API22 bitmap decoder");check(files(new File(context.getFilesDir(),"images"))==before,"online still preview creates no cached image file");still.close();
            context.getSharedPreferences("MainActivity",Context.MODE_PRIVATE).edit().putBoolean("folderView",true).commit();
            MainActivity activity=(MainActivity)test.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));test.waitForIdleSync();test.runOnMainSync(()->activity.findViewById(R.id.nav_library).performClick());test.waitForIdleSync();Thread.sleep(600);check(label(activity.getWindow().getDecorView(),"切换海报墙")!=null,"native library folder view visible and remote-focusable");Bitmap shot=test.getUiAutomation().takeScreenshot();try(FileOutputStream output=new FileOutputStream(new File(context.getFilesDir(),"features-folders.png"))){shot.compress(Bitmap.CompressFormat.PNG,100,output);}shot.recycle();test.runOnMainSync(activity::finish);test.waitForIdleSync();
        }finally{try(Library library=new Library(context)){library.restore(preserved);}context.getSharedPreferences("MainActivity",Context.MODE_PRIVATE).edit().putBoolean("folderView",false).commit();}
    }
    void run(String phase,String buildRun){Bundle result=new Bundle();context=test.getTargetContext();JSONObject report=new JSONObject();try{if(phase.equals("upgrade"))upgrade();else features();Json.put(report,"result","passed");result.putString("result","passed");}catch(Throwable error){Json.put(report,"result","failed");Json.put(report,"error",error.toString());result.putString("result","failed");result.putString("error",error.toString());}Json.put(report,"checks",new JSONArray(checks));Json.put(report,"apiLevel",android.os.Build.VERSION.SDK_INT);Json.put(report,"buildRun",buildRun);Json.put(report,"phase",phase);Json.put(report,"physicalTelevisionVerified",false);try(FileOutputStream output=new FileOutputStream(new File(context.getFilesDir(),"features-"+phase+".json"))){output.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}catch(Exception error){result.putString("result","failed");}test.finish("passed".equals(result.getString("result"))?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);}
}
