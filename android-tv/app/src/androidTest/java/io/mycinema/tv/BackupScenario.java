package io.mycinema.tv;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Actual API22 databases, document-provider I/O and settings actions. No real account is used. */
final class BackupScenario {
    private final Instrumentation test;private final Context context;private final TvBackup backup;
    private Instrumentation.ActivityMonitor mainMonitor;private final List<String> checks=new ArrayList<>();
    interface Work {void run() throws Exception;}interface Condition {boolean ready() throws Exception;}
    BackupScenario(Instrumentation test){this.test=test;context=test.getTargetContext();backup=new TvBackup(context);}
    private void check(boolean value,String label){if(!value)throw new AssertionError(label);}
    private void await(Condition condition,String label) throws Exception {long until=System.currentTimeMillis()+10000;while(System.currentTimeMillis()<until){if(condition.ready())return;Thread.sleep(50);}throw new AssertionError("timeout: "+label);}
    private MainActivity activity(){return (MainActivity)mainMonitor.getLastActivity();}
    private View label(View view,String text){if(view instanceof TextView&&((TextView)view).getText().toString().equals(text))return view;if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){View result=label(((ViewGroup)view).getChildAt(i),text);if(result!=null)return result;}return null;}
    private void idle() throws Exception {test.waitForIdleSync();Thread.sleep(150);}
    private boolean working() throws Exception {java.lang.reflect.Field field=MainActivity.class.getDeclaredField("working");field.setAccessible(true);return (Boolean)field.get(activity());}
    private void button(String text) throws Exception {await(()->activity()!=null&&!activity().isDestroyed()&&label(activity().getWindow().getDecorView(),text)!=null,"settings button "+text);test.runOnMainSync(()->check(label(activity().getWindow().getDecorView(),text).requestFocus(),"remote focus"));idle();test.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);idle();}
    private void dialog(String text) throws Exception {await(()->{AccessibilityNodeInfo root=test.getUiAutomation().getRootInActiveWindow();if(root==null)return false;for(AccessibilityNodeInfo node:root.findAccessibilityNodeInfosByText(text))if(text.contentEquals(node.getText())&&node.isClickable())return node.performAction(AccessibilityNodeInfo.ACTION_CLICK);return false;},"dialog action "+text);idle();}
    private Instrumentation.ActivityMonitor picker(String action,Uri uri,int result) throws Exception {IntentFilter filter=new IntentFilter(action);filter.addCategory(Intent.CATEGORY_OPENABLE);filter.addDataType("*/*");return test.addMonitor(filter,new Instrumentation.ActivityResult(result,new Intent().setData(uri)),true);}
    private String state() throws Exception {JSONObject value=backup.snapshot();value.remove("createdAt");return value.toString();}
    private void rejects(Work work,String label) throws Exception {String before=state();boolean failed=false;try{work.run();}catch(Exception expected){failed=true;}check(failed&&before.equals(state()),label);checks.add(label);}
    private Uri uri(String name){return Uri.parse("content://io.mycinema.tv.test.backups/"+name);}
    void run(String buildRun){
        JSONObject report=new JSONObject();Bundle result=new Bundle();JSONObject original=null;String[] old=new String[3];SecretStore[] stores={new SecretStore(context),new SecretStore(context,"quark","夸克"),new SecretStore(context,"webdav","WebDAV")};File exported=null,legacyFile=null;
        Json.put(report,"buildRun",buildRun);Json.put(report,"apiLevel",android.os.Build.VERSION.SDK_INT);Json.put(report,"sharedStorageState",android.os.Environment.getExternalStorageState());
        try{
            original=backup.snapshot();for(int i=0;i<stores.length;i++)old[i]=stores[i].read();
            stores[0].save("backup-fixture-metadata-secret");stores[1].save("__puus=backup-fixture-cookie");stores[2].save("{\"url\":\"https://example.test/dav/\",\"user\":\"fixture-user\",\"password\":\"backup-fixture-password\"}");
            String film;
            try(Library library=new Library(context)){JSONObject candidate=new JSONObject();Json.put(candidate,"title","备份验证影片");Json.put(candidate,"mediaType","movie");film=library.saveCandidate(candidate).id();JSONObject entry=new JSONObject();Json.put(entry,"personalReview","测试短评 · 中文");Json.put(entry,"personalRating",9);library.updateEntry(film,entry);}
            try(MediaCatalog catalog=new MediaCatalog(context)){
                MediaSources.Entry file=new MediaSources.Entry("quark","backup-file","Movie.2020.1080p.H264.AAC.mp4","backup-folder",false,123456);catalog.put(file,film);catalog.associate(file.key(),film);catalog.progress(file.key(),60000,180000);
                MediaSources.Entry unlink=new MediaSources.Entry("quark","backup-unlink","Movie.S00E01.mkv","backup-folder",false,1024);catalog.put(unlink,film);catalog.associate(unlink.key(),"");
                MediaSources.Entry dav=new MediaSources.Entry("webdav","https://example.test/dav/movie.mkv","Movie.mkv","https://example.test/dav/",false,9876);catalog.put(dav,film);catalog.progress(dav.key(),20000,120000);
                JSONObject row=catalog.get(file.key());Json.put(row,"headers",Json.object("{\"Authorization\":\"backup-fixture-header\"}"));Json.put(row,"downloadUrl","https://cdn.example.test/movie?token=backup-fixture-cdn");Json.put(row,"davPath","old-local-route");ContentValues values=new ContentValues();values.put("json",row.toString());catalog.getWritableDatabase().update("files",values,"id=?",new String[]{file.key()});
            }
            String cloudVariant="high|1920|1080|h264|aac|2|HLS",secondVariant="normal|1280|720|h264|aac|2|HLS";
            try(CloudPlaybackProgress cloud=new CloudPlaybackProgress(context)){cloud.save("quark:backup-file",cloudVariant,41000,180000);cloud.save("quark:backup-file",secondVariant,52000,180000);}
            JSONObject portable=backup.snapshot();String encoded=new String(TvBackup.encode(portable),StandardCharsets.UTF_8);
            for(String secret:new String[]{"backup-fixture-metadata-secret","backup-fixture-cookie","backup-fixture-password","backup-fixture-header","backup-fixture-cdn","old-local-route","upgrade-private-cloud-fixture"})check(!encoded.contains(secret),"credentials and temporary routes excluded");
            check(portable.optInt("formatVersion")==3&&portable.getJSONArray("cloudProgress").length()>=2,"portable backup includes cloud timelines");
            JSONObject unknown=Json.copy(portable);Json.put(unknown.getJSONArray("cloudProgress").getJSONObject(0),"Cookie","cloud-unknown-private-cookie");Json.put(unknown.getJSONArray("cloudProgress").getJSONObject(0),"url","https://cdn.example/?token=cloud-unknown-private-token");
            check(!new String(TvBackup.encode(unknown),StandardCharsets.UTF_8).contains("cloud-unknown-private")&&unknown.toString().contains("cloud-unknown-private"),"v3 encoding strips unknown cloud fields without modifying input");
            check(!TvBackup.read(new ByteArrayInputStream(unknown.toString().getBytes(StandardCharsets.UTF_8))).toString().contains("cloud-unknown-private"),"v3 reading strips unknown cloud credentials and URLs");Json.put(report,"cloudUnknownFieldsExcluded",true);checks.add("v3 encode/read strip unknown cloud credentials and signed URLs without mutating the input");
            checks.add("v3 snapshot includes stable Quark/WebDAV identities, manual links/unlinks and progress; excludes account secrets, unknown headers and temporary routes");

            test.setInTouchMode(false);mainMonitor=test.addMonitor(MainActivity.class.getName(),null,false);test.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));idle();
            test.runOnMainSync(()->activity().findViewById(R.id.nav_settings).requestFocus());test.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);idle();
            Instrumentation.ActivityMonitor export=picker(Intent.ACTION_CREATE_DOCUMENT,uri("portable.json"),Activity.RESULT_OK);
            try{button("导出备份文件");await(()->export.getHits()==1&&!working(),"document export callback finishes");}finally{test.removeMonitor(export);}
            JSONObject document=backup.readDocument(uri("portable.json"));check(document.getJSONObject("media").getJSONArray("files").length()>=3,"real ContentResolver document contains media catalog");
            checks.add("remote settings export issues ACTION_CREATE_DOCUMENT and writes a readable v3 file through a separate test document provider");
            try(Library library=new Library(context)){JSONObject extra=new JSONObject();Json.put(extra,"title","恢复前临时影片");Json.put(extra,"mediaType","movie");library.saveCandidate(extra);}
            try(MediaCatalog catalog=new MediaCatalog(context)){catalog.associate("quark:backup-file","changed");catalog.progress("quark:backup-file",5000,180000);}
            try(CloudPlaybackProgress cloud=new CloudPlaybackProgress(context)){cloud.save("quark:backup-file",cloudVariant,55000,180000);}
            String changed=state();final Instrumentation.ActivityMonitor cancelImport=picker(Intent.ACTION_OPEN_DOCUMENT,uri("portable.json"),Activity.RESULT_OK);
            try{button("从备份文件恢复");await(()->cancelImport.getHits()==1&&!working(),"backup preview read");dialog("取消");check(changed.equals(state()),"cancelled confirmation changes none of the databases");}finally{test.removeMonitor(cancelImport);}
            final Instrumentation.ActivityMonitor restoring=picker(Intent.ACTION_OPEN_DOCUMENT,uri("portable.json"),Activity.RESULT_OK);
            try{button("从备份文件恢复");await(()->restoring.getHits()==1&&!working(),"backup preview");dialog("确认");await(()->!working(),"restore finished");}finally{test.removeMonitor(restoring);}
            try(MediaCatalog catalog=new MediaCatalog(context)){check(Json.text(catalog.get("quark:backup-file"),"filmId").equals(film)&&catalog.position("quark:backup-file")==60000,"manual link and progress restored");check(catalog.get("quark:backup-unlink").optBoolean("associationManual")&&Json.text(catalog.get("quark:backup-unlink"),"filmId").isEmpty(),"manual unlink restored");}
            try(CloudPlaybackProgress cloud=new CloudPlaybackProgress(context)){check(cloud.position("quark:backup-file",cloudVariant)==41000&&cloud.position("quark:backup-file",secondVariant)==52000,"document restore recovers both independent cloud timelines");}
            check(backup.readLocal("before-restore.json").getJSONArray("cloudProgress").length()>=2,"recovery copy includes pre-restore cloud progress");Json.put(report,"cloudProgressRoundTripVerified",true);checks.add("v3 document export/cancel/restore and recovery copy include independent cloud timelines without changing original progress");
            JSONObject empty=Json.copy(portable);Json.put(empty,"cloudProgress",new JSONArray());backup.restore(empty);
            try(CloudPlaybackProgress cloud=new CloudPlaybackProgress(context)){check(cloud.position("quark:backup-file",cloudVariant)==0,"empty v3 cloud list clears replaced timelines without importing old preferences again");}backup.restore(portable);
            checks.add("explicit empty v3 cloud list replaces cloud history and reopening does not reimport stale preferences");
            JSONObject v2=Json.copy(portable);Json.put(v2,"formatVersion",2);v2.remove("cloudProgress");try(CloudPlaybackProgress cloud=new CloudPlaybackProgress(context)){cloud.save("quark:backup-file",cloudVariant,56000,180000);}backup.restore(v2);
            try(CloudPlaybackProgress cloud=new CloudPlaybackProgress(context);MediaCatalog catalog=new MediaCatalog(context)){check(cloud.position("quark:backup-file",cloudVariant)==56000&&catalog.position("quark:backup-file")==60000,"v2 restores original progress while retaining local cloud progress");}
            try(OutputStream output=context.getContentResolver().openOutputStream(uri("legacy-media.json"),"wt")){output.write(TvBackup.encode(v2));}
            String beforeLegacyPreview=state();Instrumentation.ActivityMonitor legacyPreview=picker(Intent.ACTION_OPEN_DOCUMENT,uri("legacy-media.json"),Activity.RESULT_OK);
            try{
                button("从备份文件恢复");await(()->{AccessibilityNodeInfo root=test.getUiAutomation().getRootInActiveWindow();return legacyPreview.getHits()==1&&root!=null&&!root.findAccessibilityNodeInfosByText("旧备份不含云端进度").isEmpty();},"legacy media restore preview explains retained cloud progress");dialog("取消");check(beforeLegacyPreview.equals(state()),"legacy preview cancellation preserves all stores");
            }finally{test.removeMonitor(legacyPreview);}
            Json.put(report,"legacyV2PreviewExplainsCloudPreservation",true);checks.add("legacy v2 restore confirmation tells remote users cloud progress is retained; cancel preserves all stores");
            Json.put(report,"legacyV2PreservesCloudProgress",true);checks.add("legacy v2 media backup restores collection/original progress while preserving current cloud timelines");backup.restore(portable);
            try(Library library=new Library(context)){check(Json.text(library.get(film).entry,"personalReview").equals("测试短评 · 中文")&&library.get(film).entry.optInt("personalRating")==9,"collection review and rating restored");}
            check(backup.readLocal("before-restore.json").optInt("formatVersion")==3,"recovery copy covers all three databases");checks.add("document import confirmation/cancel and v3 restore preserve review, manual link/unlink and exact progress; complete recovery snapshot is saved first");
            android.util.AtomicFile interrupted=new android.util.AtomicFile(new File(context.getFilesDir(),"backup-fixture-recovery.json"));
            try{
                backup.writeLocal("backup-fixture-recovery.json",portable);
                // Leave a partial new base and the prior .bak, as after interrupted AtomicFile output.
                try(FileOutputStream output=interrupted.startWrite()){output.write('{');}
                check(backup.readLocal("backup-fixture-recovery.json").optInt("formatVersion")==3,"interrupted local write recovers the prior complete backup");
                Json.put(report,"atomicFileRecoveryVerified",true);checks.add("interrupted private backup output recovers the prior complete AtomicFile snapshot");
            }finally{interrupted.delete();}

            button("导出到下载目录");await(()->!working(),"legacy downloads export");List<File> downloads=backup.downloadBackups();check(!downloads.isEmpty(),"public downloads file exists");exported=downloads.get(0);check(backup.readFile(exported).optInt("formatVersion")==3,"download file can be read back");
            button("从下载目录恢复");await(()->!working(),"download listing");dialog(exported.getName());await(()->!working(),"download file preview");dialog("确认");await(()->!working(),"download restore");checks.add("API22 remote settings export to shared Download/MyCinema and restore selected file through confirmation");

            JSONObject legacy;try(Library library=new Library(context)){legacy=library.snapshot();JSONObject extra=new JSONObject();Json.put(extra,"title","旧版恢复前新增");Json.put(extra,"mediaType","movie");library.saveCandidate(extra);}
            String mediaBefore=backup.snapshot().getJSONObject("media").toString(),cloudBefore=backup.snapshot().getJSONArray("cloudProgress").toString();backup.restore(legacy);check(mediaBefore.equals(backup.snapshot().getJSONObject("media").toString())&&cloudBefore.equals(backup.snapshot().getJSONArray("cloudProgress").toString()),"v1 restore leaves media and both progress stores unchanged");Json.put(report,"legacyV1PreservesCloudProgress",true);checks.add("legacy v1 collection backup remains readable and restores only collection while retaining current media/progress");
            legacyFile=new File(exported.getParentFile(),"legacy-collection.json");try(FileOutputStream output=new FileOutputStream(legacyFile)){output.write(TvBackup.encode(legacy));}check(backup.downloadBackups().contains(legacyFile),"legacy filename is discoverable without new export prefix");checks.add("downloads import discovers legacy JSON filenames as well as current exports");
            JSONObject bad=Json.copy(portable);Json.put(bad,"formatVersion",99);rejects(()->backup.restore(bad),"unknown version rejected without data change");
            JSONObject fractional=Json.copy(portable);Json.put(fractional,"formatVersion",2.5);rejects(()->backup.restore(fractional),"fractional version is rejected instead of rounded down");
            JSONObject duplicate=Json.copy(portable);duplicate.getJSONObject("media").getJSONArray("files").put(duplicate.getJSONObject("media").getJSONArray("files").getJSONObject(0));rejects(()->backup.restore(duplicate),"duplicate media identity rejected before restore");
            JSONObject duplicateCloud=Json.copy(portable);duplicateCloud.getJSONArray("cloudProgress").put(duplicateCloud.getJSONArray("cloudProgress").getJSONObject(0));rejects(()->backup.restore(duplicateCloud),"duplicate cloud timeline rejected before any database changes");
            JSONObject missingCloud=Json.copy(portable);missingCloud.remove("cloudProgress");rejects(()->backup.restore(missingCloud),"v3 missing cloud list rejected without changes");
            JSONObject badCloud=Json.copy(portable);Json.put(badCloud.getJSONArray("cloudProgress").getJSONObject(0),"position",1.5);rejects(()->backup.restore(badCloud),"fractional cloud progress rejected without changes");
            rejects(()->TvBackup.read(new ByteArrayInputStream("{\"format\":".getBytes(StandardCharsets.UTF_8))),"truncated JSON rejected without data change");
            rejects(()->backup.exportDocument(uri("denied.json")),"provider write failure does not change live data");
            rejects(()->backup.readDocument(uri("denied.json")),"provider read failure does not change live data");
            rejects(()->TvBackup.read(new InputStream(){int left=TvBackup.MAX_BYTES+1;public int read(){return left-->0?' ':-1;}public int read(byte[] bytes,int off,int length){if(left<=0)return -1;int count=Math.min(left,length);java.util.Arrays.fill(bytes,off,off+count,(byte)' ');left-=count;return count;}}),"oversized input rejected without data change");

            // Change both stores so a partial restore could not pass by restoring identical data.
            try(Library library=new Library(context)){JSONObject extra=new JSONObject();Json.put(extra,"title","回滚必须保留的影片");Json.put(extra,"mediaType","movie");library.saveCandidate(extra);}
            try(MediaCatalog catalog=new MediaCatalog(context)){catalog.associate("quark:backup-file","rollback-current");catalog.progress("quark:backup-file",65000,180000);}
            // Fail after the collection and file rows have been replaced, at progress insertion.
            try(MediaCatalog catalog=new MediaCatalog(context)){catalog.getWritableDatabase().execSQL("CREATE TRIGGER backup_failure BEFORE INSERT ON progress BEGIN SELECT RAISE(ABORT,'controlled backup failure'); END");}
            try{rejects(()->backup.restore(portable),"late media insert failure rolls back both SQLite databases");Json.put(report,"atomicRollbackVerified",true);}finally{try(MediaCatalog catalog=new MediaCatalog(context)){catalog.getWritableDatabase().execSQL("DROP TRIGGER IF EXISTS backup_failure");}}
            try(CloudPlaybackProgress cloud=new CloudPlaybackProgress(context)){cloud.save("quark:backup-file",cloudVariant,66000,180000);cloud.getWritableDatabase().execSQL("CREATE TRIGGER cloud_backup_failure BEFORE INSERT ON progress BEGIN SELECT RAISE(ABORT,'controlled cloud backup failure'); END");}
            try{rejects(()->backup.restore(portable),"late cloud insert failure rolls back collection, media/original progress and cloud progress together");Json.put(report,"threeDatabaseRollbackVerified",true);}finally{try(CloudPlaybackProgress cloud=new CloudPlaybackProgress(context)){cloud.getWritableDatabase().execSQL("DROP TRIGGER IF EXISTS cloud_backup_failure");}}
            check(stores[0].read().equals("backup-fixture-metadata-secret")&&stores[1].read().equals("__puus=backup-fixture-cookie")&&stores[2].read().contains("backup-fixture-password"),"all login stores unchanged across success and failure");checks.add("TMDB, Quark and WebDAV encrypted login stores remain unchanged");
            Bitmap image=test.getUiAutomation().takeScreenshot();if(image!=null){try(FileOutputStream output=new FileOutputStream(new File(context.getFilesDir(),"tv-backup-settings.png"))){image.compress(Bitmap.CompressFormat.PNG,100,output);}image.recycle();}
            Json.put(report,"result","passed");Json.put(report,"nativeDocumentPickerUiVerified",false);Json.put(report,"separateDocumentProviderVerified",true);Json.put(report,"physicalTelevisionVerified",false);Json.put(report,"realAccountVerified",false);result.putString("result","passed");
        }catch(Throwable failure){Json.put(report,"result","failed");Json.put(report,"error",failure.toString());result.putString("result","failed");result.putString("error",failure.toString());}
        finally{
            try{if(original!=null)backup.restore(original);for(int i=0;i<stores.length;i++)if(old[i]!=null){if(old[i].isEmpty())stores[i].clear();else stores[i].save(old[i]);}if(exported!=null)exported.delete();if(legacyFile!=null)legacyFile.delete();}catch(Exception cleanup){result.putString("result","failed");Json.put(report,"result","failed");Json.put(report,"cleanupError",cleanup.getClass().getSimpleName());}
            if(mainMonitor!=null){Activity owner=mainMonitor.getLastActivity();if(owner!=null)test.runOnMainSync(owner::finish);test.removeMonitor(mainMonitor);}
            Json.put(report,"checks",new JSONArray(checks));try(FileOutputStream output=new FileOutputStream(new File(context.getFilesDir(),"tv-backup-report.json"))){output.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}catch(Exception failure){result.putString("result","failed");}
            test.finish("passed".equals(result.getString("result"))?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);
        }
    }
}
