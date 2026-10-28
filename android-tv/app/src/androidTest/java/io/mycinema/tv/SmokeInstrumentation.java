package io.mycinema.tv;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.BitmapDrawable;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;

/** Installed separately on a disposable emulator; no fixture hook is shipped in the app. */
public final class SmokeInstrumentation extends Instrumentation {
    private final List<String> checks=new ArrayList<>();
    private Context context;
    private MainActivity activity;
    private Bundle arguments;
    @Override public void onCreate(Bundle args){arguments=args;super.onCreate(args);start();}
    private void check(boolean value,String label){if(!value)throw new AssertionError(label);}
    private void idle() throws Exception {waitForIdleSync();Thread.sleep(450);}
    private void main(Runnable action){runOnMainSync(action);}
    private JSONObject record(String title,String id,String type,int order){JSONObject film=new JSONObject();Json.put(film,"title",title);Json.put(film,"externalId",id);Json.put(film,"mediaType",type);Json.put(film,"overview","独立模拟器中的受控资料，不是用户收藏。");Json.put(film,"year",2008+order);Json.put(film,"series",TmdbClient.series(type.equals("tv")?"tmdb:tv:1396":"tmdb:collection:9",type.equals("tv")?"绝命毒师":"电影测试系列",order));return film;}
    private void launch() throws Exception {setInTouchMode(false);activity=(MainActivity)startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));idle();}
    private void shot(String name) throws Exception {idle();Bitmap bitmap=getUiAutomation().takeScreenshot();check(bitmap!=null,"emulator screenshot");try(FileOutputStream output=new FileOutputStream(new File(context.getFilesDir(),name+".png"))){bitmap.compress(Bitmap.CompressFormat.PNG,100,output);}bitmap.recycle();}
    private void clickNav(int id) throws Exception {main(()->activity.findViewById(id).performClick());idle();}
    private String artwork(int color,String hex) throws Exception {String path="backdrop/"+hex+".img";File file=new File(context.getFilesDir(),"images/"+path);check(file.getParentFile().isDirectory()||file.getParentFile().mkdirs(),"fixture image directory");Bitmap image=Bitmap.createBitmap(160,90,Bitmap.Config.RGB_565);image.eraseColor(color);try(FileOutputStream output=new FileOutputStream(file)){image.compress(Bitmap.CompressFormat.PNG,100,output);}image.recycle();return path;}
    private View title(View view,String wanted){if(view instanceof TextView&&((TextView)view).getText().toString().contains(wanted))return view;if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){View found=title(((ViewGroup)view).getChildAt(i),wanted);if(found!=null)return found;}return null;}
    @Override public void onStart(){
        Bundle result=new Bundle();try{
            context=getTargetContext();check("true".equals(arguments.getString("disposableEmulator")),"fixture must be explicitly selected");check(BuildConfig.DEBUG,"only debug application may run fixtures");check(android.os.Build.VERSION.SDK_INT==22,"must run on actual API 22 runtime");
            if("true".equals(arguments.getString("playback"))){new PlaybackScenario(this).run();return;}
            if("true".equals(arguments.getString("regression"))){new RegressionScenario(this,arguments).run();return;}
            if("true".equals(arguments.getString("networkProbe"))){
                JSONObject report=new JSONObject();boolean unauthorized=false;String reason="";
                try{java.util.Map<String,String> params=new java.util.HashMap<>();params.put("language","zh-CN");TmdbClient.request("mycinema-tv-public-invalid-key-probe","/configuration",params);}
                catch(IllegalArgumentException error){unauthorized=error.getMessage()!=null&&error.getMessage().contains("凭据无效");reason=error.getClass().getSimpleName();}
                catch(Exception error){reason=error.getClass().getSimpleName()+":"+(error.getCause()==null?"":error.getCause().getClass().getSimpleName());}
                Json.put(report,"apiLevel",22);Json.put(report,"realTmdbUnauthorizedResponseVerified",unauthorized);Json.put(report,"actualAccountMetadataVerified",false);Json.put(report,"probe","public HTTPS configuration with deliberately invalid non-secret key");Json.put(report,"diagnosticClass",reason);
                try(FileOutputStream file=new FileOutputStream(new File(context.getFilesDir(),"tv-network-report.json"))){file.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}
                result.putString("result",unauthorized?"passed":"failed");finish(unauthorized?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);return;
            }
            context.deleteDatabase("my-cinema-tv.db");new SecretStore(context).clear();launch();
            check(activity.findViewById(R.id.home_rail)==null,"empty install must not contain demo collection");shot("01-empty");main(activity::finish);idle();checks.add("fresh API 22 launch has no demo collection");
            SecretStore secret=new SecretStore(context);String fake="synthetic-tv-key-not-a-real-credential";secret.save(fake);check(new SecretStore(context).read().equals(fake),"API 22 RSA/AES/HMAC credential roundtrip");
            byte[] encrypted=TmdbClient.read(new java.io.FileInputStream(new File(context.getFilesDir(),"metadata-credential.bin")),16384);check(!new String(encrypted,StandardCharsets.ISO_8859_1).contains(fake),"credential is not plaintext");checks.add("real API 22 Android Keystore hybrid encryption survives store recreation");
            TmdbClient tmdb=new TmdbClient((path,params)->{
                if(path.endsWith("/images")){
                    if(path.contains("/season/"))return Json.object("{\"posters\":[{\"file_path\":\"/s2-en.jpg\",\"iso_639_1\":\"en\",\"width\":1000,\"height\":1500}]}");
                    return Json.object("{\"posters\":[],\"backdrops\":[{\"file_path\":\"/a-art.jpg\",\"iso_639_1\":null,\"width\":1920,\"height\":1080},{\"file_path\":\"/b-art.jpg\",\"iso_639_1\":null,\"width\":1920,\"height\":1080}]}");
                }
                if(path.equals("/tv/1396"))return Json.object("{\"id\":1396,\"name\":\"绝命毒师\",\"original_name\":\"Breaking Bad\",\"overview\":\"整剧简介\",\"first_air_date\":\"2008-01-20\",\"backdrop_path\":\"/whole.jpg\",\"seasons\":[{\"season_number\":1},{\"season_number\":2}]}");
                if(path.equals("/tv/1396/season/2"))return Json.object("{\"season_number\":2,\"air_date\":\"2009-03-08\",\"overview\":\"第二季简介\",\"poster_path\":\"/s2.jpg\",\"episodes\":[{\"runtime\":48},{\"still_path\":\"/s2-still.jpg\"}]}");
                if(path.equals("/tv/1396/season/1"))return Json.object("{\"season_number\":1,\"air_date\":\"2008-01-20\",\"overview\":\"\",\"episodes\":[]}");
                if(path.equals("/search/tv"))return Json.object("{\"results\":[{\"id\":1396,\"name\":\"绝命毒师\",\"first_air_date\":\"2008-01-20\"}]}");
                throw new IllegalArgumentException("unexpected test endpoint");
            },"zh-CN");
            JSONObject second=tmdb.candidate("1396:season:2","tv"),first=tmdb.candidate("1396:season:1","tv");
            check(second.optInt("year")==2009&&Json.text(second,"backdropUrl").endsWith("/b-art.jpg"),"season year and high-resolution show gallery variant");check(Json.text(first,"backdropUrl").endsWith("/a-art.jpg")&&first.isNull("overview"),"season variants do not substitute the series overview");check(tmdb.search("绝命毒师","tv").size()==1,"search normalization");check(Json.array(tmdb.seasonList("1396"),"seasons").length()==2,"season list");
            boolean rejected=false;try{tmdb.candidate("1396:season:2","movie");}catch(IllegalArgumentException error){rejected=true;}check(rejected,"season identity rejected for movie");checks.add("controlled TMDB search, season identity, season-specific year, gallery artwork and missing-overview semantics");
            check(Json.text(second,"posterUrl").endsWith("/s2-en.jpg"),"season poster uses classified English gallery art");
            JSONArray mixed=Json.array(Json.object("{\"posters\":[{\"file_path\":\"/traditional.jpg\",\"iso_639_1\":\"zh\",\"iso_3166_1\":\"TW\",\"width\":1000,\"height\":1500},{\"file_path\":\"/unknown.jpg\",\"iso_639_1\":\"zh\",\"width\":1000,\"height\":1500},{\"file_path\":\"/english.jpg\",\"iso_639_1\":\"en\",\"width\":1000,\"height\":1500}]}"),"posters");
            check(ArtworkPolicy.poster(mixed).equals("/english.jpg"),"Traditional and unclassified Chinese posters excluded");
            mixed.put(Json.object("{\"file_path\":\"/simplified.jpg\",\"iso_639_1\":\"zh\",\"iso_3166_1\":\"CN\",\"width\":1000,\"height\":1500}"));
            check(ArtworkPolicy.poster(mixed).equals("/simplified.jpg"),"explicit mainland Chinese artwork preferred");
            checks.add("poster script/region filtering and high-resolution textless season gallery selection");
            Library library=new Library(context);String blue=artwork(Color.rgb(35,75,120),"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),orange=artwork(Color.rgb(150,85,35),"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
            Json.put(first,"backdropPath",blue);Json.put(second,"backdropPath",orange);Library.Item tv2=library.saveCandidate(second),tv1=library.saveCandidate(first);
            List<String> movies=new ArrayList<>();for(int n:new int[]{10,2,1}){JSONObject film=record("测试电影"+n,String.valueOf(900+n),"movie",n);Json.put(film,"backdropPath",n==1?blue:orange);Library.Item saved=library.saveCandidate(film);movies.add(saved.id());}
            List<Library.Item> ordered=library.list("","","","tmdb:collection:9","recent");check(ordered.get(0).order()==1&&ordered.get(1).order()==2&&ordered.get(2).order()==10,"natural series ordering 1/2/10");
            JSONObject patch=new JSONObject();Json.put(patch,"personalRating",9);Json.put(patch,"personalReview","私人短评");Json.put(patch,"watchStatus","watched");library.updateEntry(tv1.id(),patch);check(library.saveCandidate(first).entry.optInt("personalRating")==9,"duplicate import retains rating");
            Json.put(first,"overview","刷新后的简介");library.refresh(tv1.id(),first);check(Json.text(library.get(tv1.id()).entry,"personalReview").equals("私人短评"),"refresh keeps personal review");
            library.saveCollection("","验证专题","模拟器专题");String collection=Json.text(library.collections().get(0),"id");library.setMemberships(tv1.id(),new HashSet<>(Arrays.asList(collection)));check(library.list("","",collection,"","recent").size()==1,"collection membership");
            JSONObject resource=new JSONObject();Json.put(resource,"resourceName","验证资源");Json.put(resource,"shareUrl","https://pan.quark.cn/s/fixture");library.saveResource(tv1.id(),resource);
            JSONObject snapshot=library.snapshot();check(!snapshot.toString().contains(fake),"backup excludes credential");library.remove(tv1.id());library.restore(snapshot);check(library.get(tv1.id()).entry.optInt("personalRating")==9&&library.resources(tv1.id()).size()==1,"backup restores records and resource association");
            JSONObject broken=Json.copy(snapshot);Json.put(broken,"entries",new JSONArray());boolean rollback=false;try{library.restore(broken);}catch(Exception error){rollback=true;}check(rollback&&library.get(tv1.id())!=null,"invalid restore rolls back atomically");
            library.close();library=new Library(context);check(library.list("","","","","recent").size()==5&&library.get(tv1.id()).entry.optInt("personalRating")==9,"real SQLite reopen persistence");library.close();checks.add("real SQLite imports, duplicate protection, personal data, series sorting, topics, resources, atomic restore and reopen persistence");
            launch();check(activity.findViewById(R.id.home_rail)!=null,"home poster rail");check((activity.getWindow().getDecorView().getSystemUiVisibility()&View.SYSTEM_UI_FLAG_HIDE_NAVIGATION)!=0,"TV requests immersive navigation");shot("02-home");
            check(activity.getCurrentFocus()!=null&&activity.getCurrentFocus().getContentDescription()!=null,"home must focus a poster before remote navigation");
            String before=((TextView)activity.findViewById(R.id.hero_title)).getText().toString();sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT);idle();String after=((TextView)activity.findViewById(R.id.hero_title)).getText().toString();check(!before.equals(after),"D-pad focus updates hero title: "+before+" -> "+after);shot("03-home-next-focus");
            sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);idle();check(activity.findViewById(R.id.detail_title)!=null,"remote confirm opens detail");check(activity.getCurrentFocus() instanceof TextView&&((TextView)activity.getCurrentFocus()).getText().toString().equals("查看资源"),"detail focus starts on content action");shot("04-film-detail");sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);idle();check(activity.findViewById(R.id.home_rail)!=null,"back returns to browsing instead of exiting");checks.add("real D-pad right updates hero, center opens detail, detail starts on content action, Back returns to browsing");
            clickNav(R.id.nav_library);check(((GridView)activity.findViewById(R.id.library_grid)).getAdapter().getCount()==5,"poster wall entries");shot("05-library");
            clickNav(R.id.nav_collections);check(title(activity.getWindow().getDecorView(),"验证专题")!=null,"topics rendered");shot("06-collections");
            clickNav(R.id.nav_watchlist);check(((GridView)activity.findViewById(R.id.library_grid)).getAdapter().getCount()==4,"want-to-watch filter");shot("07-watchlist");
            clickNav(R.id.nav_settings);check(title(activity.getWindow().getDecorView(),"TMDB配置：已保存")!=null,"configured credential status");shot("08-settings");checks.add("native library, topics, watchlist and settings render on API 22");
            JSONObject report=new JSONObject();Json.put(report,"result","passed");Json.put(report,"apiLevel",android.os.Build.VERSION.SDK_INT);Json.put(report,"emulatorOnly",true);Json.put(report,"actualTelevisionVerified",false);Json.put(report,"actualAccountMetadataVerified",false);Json.put(report,"syntheticCredentialOnly",true);Json.put(report,"checks",new JSONArray(checks));try(FileOutputStream file=new FileOutputStream(new File(context.getFilesDir(),"tv-smoke-report.json"))){file.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}
            result.putString("result","passed");finish(Activity.RESULT_OK,result);
        }catch(Throwable error){result.putString("result","failed");result.putString("reason",error.toString());finish(Activity.RESULT_CANCELED,result);}
    }
}
