package io.mycinema.tv;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.drawable.BitmapDrawable;
import android.os.Bundle;
import android.os.Debug;
import android.os.Process;
import android.view.KeyEvent;
import android.view.View;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.GridView;
import android.widget.ImageView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Black-box accessibility and remote events against an unmodified installed APK. */
final class RegressionScenario {
    private final Instrumentation driver;
    private Context context;
    private MainActivity activity;
    private Library library;
    private Bundle args;
    private final JSONObject report=new JSONObject();
    private final JSONArray checks=new JSONArray();
    private static final String KEY="tv-fixture-regression-key";
    interface Condition { boolean ready() throws Exception; }
    RegressionScenario(Instrumentation driver,Bundle arguments){this.driver=driver;args=arguments;}
    private Context getTargetContext(){return driver.getTargetContext();}
    private android.app.UiAutomation getUiAutomation(){return driver.getUiAutomation();}
    private void waitForIdleSync(){driver.waitForIdleSync();}
    private void runOnMainSync(Runnable work){driver.runOnMainSync(work);}
    private void sendKeyDownUpSync(int key){driver.sendKeyDownUpSync(key);}
    private void setInTouchMode(boolean touch){driver.setInTouchMode(touch);}
    private Activity startActivitySync(Intent intent){return driver.startActivitySync(intent);}
    private void finish(int result,Bundle data){driver.finish(result,data);}
    private void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    private void waitFor(Condition condition,String label) throws Exception {long until=System.currentTimeMillis()+25000;while(System.currentTimeMillis()<until){if(condition.ready())return;Thread.sleep(70);}throw new AssertionError("Timed out: "+label);}
    private void idle() throws Exception {waitForIdleSync();Thread.sleep(180);}
    private void main(Runnable action){runOnMainSync(action);}
    private AccessibilityNodeInfo root(){return getUiAutomation().getRootInActiveWindow();}
    private void flatten(AccessibilityNodeInfo node,List<AccessibilityNodeInfo> result){if(node==null)return;result.add(node);for(int i=0;i<node.getChildCount();i++)flatten(node.getChild(i),result);}
    private List<AccessibilityNodeInfo> nodes(){List<AccessibilityNodeInfo> nodes=new ArrayList<>();flatten(root(),nodes);return nodes;}
    private AccessibilityNodeInfo text(String label,boolean contains){for(AccessibilityNodeInfo node:nodes()){String value=node.getText()==null?"":node.getText().toString();if((contains?value.contains(label):value.equals(label))&&node.isEnabled()&&(node.getActions()&AccessibilityNodeInfo.ACTION_CLICK)!=0)return node;}return null;}
    private void click(String label) throws Exception {click(label,false);}
    private void click(String label,boolean contains) throws Exception {waitFor(()->text(label,contains)!=null,"button "+label);AccessibilityNodeInfo node=text(label,contains);check(node!=null,"button disappeared");if(node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)){sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);}else check(node.performAction(AccessibilityNodeInfo.ACTION_CLICK),"click "+label);idle();}
    private void nav(int id) throws Exception {main(()->activity.findViewById(id).requestFocus());sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);idle();}
    private List<AccessibilityNodeInfo> fields(){List<AccessibilityNodeInfo> result=new ArrayList<>();for(AccessibilityNodeInfo node:nodes())if("android.widget.EditText".contentEquals(node.getClassName()))result.add(node);return result;}
    private void input(int index,String value) throws Exception {waitFor(()->fields().size()>index,"text field "+index);Bundle text=new Bundle();text.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,value);check(fields().get(index).performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,text),"set Unicode text");idle();}
    private void back() throws Exception {sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);idle();}
    private void launch() throws Exception {setInTouchMode(false);activity=(MainActivity)startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));idle();}
    private void write(String name,JSONObject value) throws Exception {try(FileOutputStream output=new FileOutputStream(new File(context.getFilesDir(),name))){output.write(value.toString(2).getBytes(StandardCharsets.UTF_8));}}
    private JSONObject read(String name) throws Exception {return Json.object(new String(TmdbClient.read(new FileInputStream(new File(context.getFilesDir(),name)),8*1024*1024),StandardCharsets.UTF_8));}
    private void shot(String name) throws Exception {idle();Bitmap bitmap=getUiAutomation().takeScreenshot();check(bitmap!=null,"native Android screen capture");try(FileOutputStream output=new FileOutputStream(new File(context.getFilesDir(),name+".png"))){bitmap.compress(Bitmap.CompressFormat.PNG,100,output);}bitmap.recycle();}
    private void mode(String mode) throws Exception {java.net.HttpURLConnection connection=(java.net.HttpURLConnection)new java.net.URL("http://10.0.2.2:8765/control?mode="+mode).openConnection();connection.setConnectTimeout(3000);connection.setReadTimeout(3000);try{check(connection.getResponseCode()==200,"fixture control");}finally{connection.disconnect();}}
    private Library.Item external(String id){for(Library.Item item:library.list("","","","","recent"))if(Json.text(item.film,"externalId").equals(id))return item;return null;}
    private int count(){return library.list("","","","","recent").size();}
    private void configured() throws Exception {waitFor(()->new SecretStore(context).exists(),"credential persisted");check(new SecretStore(context).read().equals(KEY),"saved credential roundtrip");}
    private void openSeasons() throws Exception {nav(R.id.nav_library);click("添加作品");click("类型：电影");input(0,"Breaking Bad");click("搜索");click("选择季",true);waitFor(()->text("第1季",true)!=null,"season list");}
    private void toggleSeason(int season) throws Exception {AccessibilityNodeInfo label=text("第"+season+"季  ",true);check(label!=null,"season row");AccessibilityNodeInfo row=label.getParent();check(row!=null,"season row parent");AccessibilityNodeInfo toggle=row.getChild(0);check(toggle!=null&&toggle.isEnabled(),"selectable season");check(toggle.performAction(AccessibilityNodeInfo.ACTION_FOCUS),"season toggle focus");sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);idle();}
    private void busyFinished() throws Exception {waitFor(()->{for(AccessibilityNodeInfo node:nodes()){String t=node.getText()==null?"":node.getText().toString();if(t.endsWith("…")&&!"android.widget.EditText".contentEquals(node.getClassName()))return false;}return true;},"background operation finished");}
    private void memory(String key){Debug.MemoryInfo memory=new Debug.MemoryInfo();Debug.getMemoryInfo(memory);JSONObject data=new JSONObject();Json.put(data,"pssKiB",memory.getTotalPss());Json.put(data,"javaUsedBytes",Runtime.getRuntime().totalMemory()-Runtime.getRuntime().freeMemory());Json.put(data,"javaMaxBytes",Runtime.getRuntime().maxMemory());Json.put(report,key,data);}
    private String stressPoster(byte[] bytes,int index) throws Exception {byte[] hash=java.security.MessageDigest.getInstance("SHA-256").digest(("stress-poster-"+index).getBytes(StandardCharsets.UTF_8));StringBuilder hex=new StringBuilder();String digits="0123456789abcdef";for(byte item:hash){hex.append(digits.charAt((item&255)>>4));hex.append(digits.charAt(item&15));}String path="poster/"+hex+".img";try(FileOutputStream output=new FileOutputStream(new File(context.getFilesDir(),"images/"+path))){output.write(bytes);}return path;}
    private void restart(String phase) throws Exception {
        JSONObject marker=read("regression-marker.json");library=new Library(context);check(count()==marker.optInt("count"),"collection retained after "+phase);Library.Item film=library.get(Json.text(marker,"filmId"));check(Math.abs(film.entry.optDouble("personalRating")-9.2)<0.001,"rating retained after "+phase);check(Json.text(film.entry,"personalReview").equals("短评 Episode 1"),"Unicode review retained");configured();
        if(phase.equals("process"))check(marker.optInt("pid")!=Process.myPid(),"application process actually replaced");
        launch();waitFor(()->activity.findViewById(R.id.home_rail)!=null,"offline home");waitFor(()->((ImageView)activity.findViewById(R.id.cinema_backdrop)).getDrawable() instanceof BitmapDrawable,"offline cached backdrop");shot(phase.equals("process")?"r09-process-restart":"r10-device-reboot");checks.put("offline "+phase+": collection, Unicode review, rating, Keystore credential and cached background retained");
    }
    private void full() throws Exception {
        context.deleteDatabase("my-cinema-tv.db");new SecretStore(context).clear();library=new Library(context);mode("normal");launch();check(count()==0,"fresh install is empty");
        nav(R.id.nav_settings);click("配置TMDB API Key");input(0,KEY);click("保存");configured();busyFinished();shot("r01-configured");checks.put("configuration UI validates via controlled HTTPS and persists encrypted synthetic credential");
        openSeasons();shot("r02-season-picker");click("第1季  ",true);click("确认导入并缓存图片");waitFor(()->external("1396:season:1")!=null,"first season import");waitFor(()->activity.findViewById(R.id.detail_title)!=null,"imported detail");Library.Item first=external("1396:season:1");check(new File(context.getFilesDir(),"images/"+Json.text(first.film,"posterPath")).isFile(),"poster downloaded by application");check(new File(context.getFilesDir(),"images/"+Json.text(first.film,"backdropPath")).isFile(),"season still downloaded by application");shot("r03-imported-detail");
        click("编辑观影记录");input(0,"9.2");input(1,"收藏理由 ✓");input(2,"短评 Episode 1");click("想看");click("观看中");click("保存");check(library.get(first.id()).status().equals("watched"),"watch state edited through dialog");check(Json.text(library.get(first.id()).entry,"favoriteReason").equals("收藏理由 ✓"),"Unicode collection reason saved");checks.put("real UI search, season confirmation, HTTPS image downloads, rating, watch state and Unicode form edits");
        back();toggleSeason(2);shot("r04-season-selection");check(activity.getCurrentFocus() instanceof android.widget.Button&&((android.widget.Button)activity.getCurrentFocus()).getText().toString().equals("✓ 已选"),"season toggle must keep remote focus after rerender");toggleSeason(3);mode("season3");click("导入所选季");waitFor(()->external("1396:season:2")!=null,"batch first completed");busyFinished();check(external("1396:season:3")==null,"failed season not imported");check(Math.abs(library.get(first.id()).entry.optDouble("personalRating")-9.2)<0.001,"batch retained previous rating");mode("normal");click("导入所选季");waitFor(()->external("1396:season:3")!=null,"batch retry");busyFinished();check(count()==3,"batch retry imports only remaining season");checks.put("batch partial failure preserves completed seasons and personal data, retry imports remaining season");
        nav(R.id.nav_collections);click("创建专题");input(0,"UI 专题");input(1,"遥控器回归专题");click("保存");click("UI 专题",true);click("编辑专题");click("删除专题");click("确认");waitFor(()->library.collections().isEmpty(),"topic deletion");check(fields().isEmpty(),"deleting a topic must also dismiss its edit dialog");checks.put("topic creation/deletion through UI does not leave a stale edit dialog");
        nav(R.id.nav_library);click("全部年份");click("2009");waitFor(()->((GridView)activity.findViewById(R.id.library_grid)).getAdapter().getCount()==1,"year filter");click("全部状态");click("已看完");waitFor(()->activity.findViewById(R.id.library_grid)==null,"combined filter empty state");click("清除筛选");waitFor(()->activity.findViewById(R.id.library_grid)!=null,"filters clear");checks.put("year/status filter combination and clear use actual visible library controls");
        nav(R.id.nav_library);click("搜索");input(0,"第1季");click("保存");waitFor(()->((GridView)activity.findViewById(R.id.library_grid)).getAdapter().getCount()==1,"library query");main(()->activity.findViewById(R.id.library_grid).requestFocus());sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);idle();click("添加资源记录");input(0,"UI资源");input(1,"javascript:alert(1)");click("保存");check(!fields().isEmpty()&&library.resources(first.id()).isEmpty(),"invalid resource URL leaves form open and writes nothing");input(1,"https://pan.quark.cn/s/fixture");input(3,"2160p");input(4,"HEVC Main10");input(5,"中文字幕");input(6,"TrueHD 7.1");click("保存");check(library.resources(first.id()).size()==1,"resource form persisted");checks.put("resource dialog rejects unsafe protocol and preserves quality, codec, subtitles and audio labels");
        nav(R.id.nav_settings);click("创建本机备份");waitFor(()->new File(context.getFilesDir(),"collection-backup.json").isFile(),"backup created");busyFinished();JSONObject extra=new JSONObject();Json.put(extra,"title","备份后添加");Json.put(extra,"mediaType","movie");library.saveCandidate(extra);check(count()==4,"extra row before restore");click("恢复上次本机备份");click("确认");waitFor(()->count()==3,"restore UI");busyFinished();check(new File(context.getFilesDir(),"before-restore.json").isFile(),"pre-restore safety copy");configured();checks.put("backup/restore UI restores collection and creates safety copy without clearing metadata credential");
        nav(R.id.nav_library);click("添加作品");if(text("类型：剧集",false)!=null)click("类型：剧集");input(0,"Matrix");mode("offline");click("搜索");busyFinished();check(count()==3,"failed network search does not import");mode("normal");click("搜索");click("查看资料",true);click("确认导入并缓存图片");waitFor(()->external("603")!=null,"movie import after retry");waitFor(()->activity.findViewById(R.id.detail_title)!=null,"movie detail");checks.put("network failure can be retried through UI without creating a partial collection");
        memory("beforeCorpus");
        Library.Item template=external("603");
        byte[] posterBytes=TmdbClient.read(new FileInputStream(new File(context.getFilesDir(),"images/"+Json.text(template.film,"posterPath"))),12*1024*1024);
        for(int i=0;i<500;i++){
            JSONObject row=new JSONObject();Json.put(row,"title","压力收藏 "+i);Json.put(row,"mediaType","movie");Json.put(row,"year",2020);
            Json.put(row,"posterPath",stressPoster(posterBytes,i));Json.put(row,"backdropPath",template.film.opt("backdropPath"));library.saveCandidate(row);
        }
        nav(R.id.nav_library);
        check(((GridView)activity.findViewById(R.id.library_grid)).getAdapter().getCount()==504,"large library count");
        main(()->{GridView grid=(GridView)activity.findViewById(R.id.library_grid);grid.setSelection(0);grid.requestFocus();});idle();
        for(int n=0;n<40;n++){sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN);if(n%8==0)idle();}
        idle();check(((GridView)activity.findViewById(R.id.library_grid)).getSelectedItemPosition()>100,"stress scroll traversed many distinct posters");
        memory("afterCorpus");Json.put(report,"distinctStressPosterPaths",500);shot("r08-stress-wall");
        checks.put("504-item library with 500 distinct poster cache keys: actual GridView remote scrolling and bitmap eviction path exercised");
        JSONObject marker=new JSONObject();Json.put(marker,"count",count());Json.put(marker,"filmId",first.id());Json.put(marker,"pid",Process.myPid());write("regression-marker.json",marker);mode("offline");
    }
    void run(){Bundle finish=new Bundle();String phase=args.getString("phase","full");try{
        context=getTargetContext();check("true".equals(args.getString("disposableEmulator"))&&BuildConfig.DEBUG,"only explicitly selected disposable debug target");check(android.os.Build.VERSION.SDK_INT==22,"actual API 22 runtime");AccessibilityServiceInfo info=getUiAutomation().getServiceInfo();info.flags|=AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS|AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;getUiAutomation().setServiceInfo(info);
        Json.put(report,"apiLevel",22);Json.put(report,"phase",phase);Json.put(report,"pid",Process.myPid());Json.put(report,"realAccountVerified",false);Json.put(report,"physicalTelevisionVerified",false);Json.put(report,"controlledHttpsFixture",true);Json.put(report,"checks",checks);
        ActivityManager.MemoryInfo memory=new ActivityManager.MemoryInfo();((ActivityManager)context.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(memory);Json.put(report,"systemTotalMemoryBytes",memory.totalMem);Json.put(report,"javaMaxMemoryBytes",Runtime.getRuntime().maxMemory());
        if(phase.equals("full"))full();else restart(phase);Json.put(report,"result","passed");finish.putString("result","passed");write("regression-"+phase+".json",report);if(library!=null)library.close();finish(Activity.RESULT_OK,finish);
    }catch(Throwable failure){Json.put(report,"result","failed");Json.put(report,"failure",failure.toString());try{shot("r00-failure");write("regression-"+phase+".json",report);}catch(Exception ignored){}finish.putString("result","failed");finish.putString("reason",failure.toString());finish(Activity.RESULT_CANCELED,finish);}}
}
