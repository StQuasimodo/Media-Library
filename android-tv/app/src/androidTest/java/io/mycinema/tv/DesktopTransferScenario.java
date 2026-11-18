package io.mycinema.tv;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Imports a fixture produced by the actual desktop SQLite exporter; no account or movie is required. */
final class DesktopTransferScenario {
    private final Instrumentation test;private final Context context;private final TvBackup backup;private final List<String> checks=new ArrayList<>();private MainActivity activity;
    DesktopTransferScenario(Instrumentation test){this.test=test;context=test.getTargetContext();backup=new TvBackup(context);}
    interface Work{void run()throws Exception;}
    private void check(boolean value,String label){if(!value)throw new AssertionError(label);checks.add(label);}
    private String state()throws Exception{JSONObject value=backup.snapshot();value.remove("createdAt");return value.toString();}
    private void rejects(Work work,String label)throws Exception{String before=state();boolean failed=false;try{work.run();}catch(Exception expected){failed=true;}check(failed&&state().equals(before),label);}
    private static JSONObject film(String title,String external){JSONObject value=new JSONObject();Json.put(value,"title",title);Json.put(value,"mediaType","movie");Json.put(value,"externalId",external);Json.put(value,"metadataSource",external.isEmpty()?"manual":"tmdb");return value;}
    private View label(View root,String value){if(root instanceof TextView&&((TextView)root).getText().toString().equals(value))return root;if(root instanceof ViewGroup)for(int n=0;n<((ViewGroup)root).getChildCount();n++){View found=label(((ViewGroup)root).getChildAt(n),value);if(found!=null)return found;}return null;}
    private void ui(Runnable action){test.runOnMainSync(action);}
    private void idle()throws Exception{test.waitForIdleSync();Thread.sleep(300);}
    private void await(Work assertion)throws Exception{long until=System.currentTimeMillis()+10000;Throwable last=null;do{try{assertion.run();return;}catch(AssertionError|Exception error){last=error;Thread.sleep(100);}}while(System.currentTimeMillis()<until);throw new AssertionError("UI result timed out",last);}
    List<String> run()throws Exception{
        JSONObject original=backup.snapshot(),report=new JSONObject();String[] credentials=new String[3];SecretStore[] stores={new SecretStore(context),new SecretStore(context,"quark","夸克"),new SecretStore(context,"webdav","WebDAV")};for(int n=0;n<stores.length;n++)credentials[n]=stores[n].exists()?stores[n].read():"";
        try{
            JSONObject desktop;try(InputStream input=test.getContext().getAssets().open("desktop-transfer-v2.json")){desktop=TvBackup.read(input);}
            check(DesktopTransfer.matches(desktop),"actual Windows export recognized by the TV file reader");
            String matrix,local;try(Library library=new Library(context)){
                matrix=library.saveCandidate(film("TV Matrix before import","603")).id();local=library.saveCandidate(film("TV-only migration preservation","")).id();JSONObject patch=new JSONObject();Json.put(patch,"personalReview","TV-only review");library.updateEntry(local,patch);library.saveCollection("","重看计划","TV topic before merge");
            }
            try(MediaCatalog catalog=new MediaCatalog(context)){
                catalog.put(new MediaSources.Entry("quark","migrate-matrix-file","The.Matrix.mkv","migrate-root",false,123456),matrix);catalog.progress("quark:migrate-matrix-file",45123,180000);
                catalog.put(new MediaSources.Entry("quark","tv-only-file","TV-only.mkv","tv-root",false,123),local);catalog.progress("quark:tv-only-file",33123,180000);
            }
            final String variant="high|1920|1080|h264|aac|2|HLS";try(CloudPlaybackProgress cloud=new CloudPlaybackProgress(context)){cloud.save("quark:migrate-matrix-file",variant,55000,180000);}
            String before=state();backup.restore(desktop);
            try(Library library=new Library(context)){
                check(library.get(local).entry.optString("personalReview").equals("TV-only review"),"TV-only collection and review survive the merge");
                check(library.get(matrix).entry.optDouble("personalRating")==8.5&&Json.text(library.get(matrix).entry,"personalReview").equals("保留电脑短评"),"same TMDB work reuses the TV identity and applies desktop personal records");
                check(library.get(matrix).film.isNull("posterPath"),"Windows image cache paths are not treated as TV files");
                Library.Item season=library.get("desktop-season");check(Json.text(season.film,"externalId").equals("1396:season:1")&&season.order()==1,"season identity and sequence are retained");
                check(Json.text(season.film.getJSONObject("series").getJSONObject("franchise"),"title").equals("犯罪宇宙"),"manual universe membership survives migration");
                int topics=0;for(JSONObject topic:library.collections())if(Json.text(topic,"name").equals("重看计划"))topics++;check(topics==1,"same-name topic is merged without duplicates");
                boolean shared=false;for(JSONObject resource:library.resources(matrix))if(Json.text(resource,"id").equals("desktop-resource")&&Json.text(resource,"accessCode").equals("test"))shared=true;check(shared,"shared resource labels and extraction code are retained");
            }
            try(MediaCatalog catalog=new MediaCatalog(context)){
                check(catalog.position("quark:migrate-matrix-file")==45123&&catalog.position("quark:tv-only-file")==33123,"existing original-file progress survives import");
                check(Json.text(catalog.get("quark:tv-only-file"),"filmId").equals(local),"TV-only media association survives import");
                JSONObject pending=catalog.get("quark:migrate-matrix-file");check(Json.text(pending,"filmId").isEmpty()&&pending.getJSONObject("desktopMatch").optBoolean("pending"),"imported mapping waits for the original directory");
                MediaSources.Entry file=new MediaSources.Entry("quark","migrate-matrix-file","Renamed.Matrix.2160p.mkv","migrate-root",false,123456);
                catalog.put(file,local,"wrong-root");check(Json.text(catalog.get(file.key()),"filmId").isEmpty(),"another mount does not activate the imported association");
                catalog.put(file,local,"migrate-root");check(Json.text(catalog.get(file.key()),"filmId").equals(matrix),"verified original directory plus file ID activates the preserved mapping despite a rename");
                catalog.put(file,local,"migrate-root");check(Json.text(catalog.get(file.key()),"filmId").equals(matrix),"subsequent scans do not replace the imported match");
                MediaSources.Entry ignored=new MediaSources.Entry("quark","migrate-ignored-file","花絮.mp4","migrate-root",false,123456);catalog.put(ignored,matrix,"migrate-root");check(catalog.get(ignored.key()).optBoolean("ignored")&&Json.text(catalog.get(ignored.key()),"filmId").isEmpty(),"previously missing ignored file remains ignored when it returns");
                catalog.put(ignored,matrix,"migrate-root");check(Json.text(catalog.get(ignored.key()),"filmId").isEmpty(),"rescanning never auto-links an ignored file");
                catalog.associate(file.key(),local);catalog.put(file,matrix,"migrate-root");check(Json.text(catalog.get(file.key()),"filmId").equals(local),"later explicit TV association overrides a migrated choice");
                catalog.ignore(ignored.key(),false);catalog.put(ignored,matrix,"migrate-root");check(Json.text(catalog.get(ignored.key()),"filmId").equals(matrix),"manual unignore restores automatic matching");
            }
            try(CloudPlaybackProgress cloud=new CloudPlaybackProgress(context)){check(cloud.position("quark:migrate-matrix-file",variant)==55000,"independent cloud version progress survives migration");}
            backup.restore(desktop);String first=state();backup.restore(desktop);check(first.equals(state()),"reimport is idempotent without duplicate films, topics or resources");
            JSONObject portable=backup.snapshot();backup.restore(TvBackup.read(new ByteArrayInputStream(TvBackup.encode(portable))));check(state().equals(first),"native TV backup round-trip retains pending choices and ignored flags");
            final JSONObject oldFormat=Json.copy(desktop);Json.put(oldFormat,"formatVersion",1);rejects(()->backup.restore(oldFormat),"old desktop archive fails clearly without changing data");
            JSONObject bad=Json.copy(desktop);bad.getJSONArray("collectionEntries").put(bad.getJSONArray("collectionEntries").getJSONObject(0));final JSONObject duplicate=bad;rejects(()->backup.restore(duplicate),"duplicate entry identities are rejected without mutation");
            final JSONObject dangling=Json.copy(desktop);Json.put(dangling.getJSONObject("quarkTransfer").getJSONArray("files").getJSONObject(1),"filmId","missing-film");rejects(()->backup.restore(dangling),"dangling resource-to-work mapping is rejected before writes");
            final JSONObject hostile=Json.copy(desktop);Json.put(hostile.getJSONObject("quarkTransfer").getJSONArray("files").getJSONObject(1),"fileId","https://private.example/cdn?token=secret");rejects(()->backup.restore(hostile),"temporary URLs are rejected as file identities");
            final JSONObject fractional=Json.copy(desktop);Json.put(fractional,"formatVersion",2.5);rejects(()->backup.restore(fractional),"fractional transfer version is rejected");
            try(MediaCatalog catalog=new MediaCatalog(context)){catalog.getWritableDatabase().execSQL("CREATE TRIGGER transfer_failure BEFORE INSERT ON files BEGIN SELECT RAISE(ABORT,'controlled transfer failure'); END");}
            try{rejects(()->backup.restore(desktop),"late media failure rolls collection, associations and progress back together");}finally{try(MediaCatalog catalog=new MediaCatalog(context)){catalog.getWritableDatabase().execSQL("DROP TRIGGER transfer_failure");}}
            try(CloudPlaybackProgress cloud=new CloudPlaybackProgress(context)){cloud.getWritableDatabase().execSQL("CREATE TRIGGER transfer_cloud_failure BEFORE INSERT ON progress BEGIN SELECT RAISE(ABORT,'controlled cloud transfer failure'); END");}
            try{rejects(()->backup.restore(desktop),"late cloud failure rolls all three databases back together");}finally{try(CloudPlaybackProgress cloud=new CloudPlaybackProgress(context)){cloud.getWritableDatabase().execSQL("DROP TRIGGER transfer_cloud_failure");}}
            JSONObject recovery=backup.readLocal("before-restore.json");backup.restore(recovery);check(state().equals(first),"recovery snapshot remains readable and restores the pre-import state");
            for(int n=0;n<stores.length;n++)check((stores[n].exists()?stores[n].read():"").equals(credentials[n]),"login store "+n+" remains on the television");
            // Exercise the real confirmation UI with the actual exported document already read.
            activity=(MainActivity)test.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));idle();
            final java.lang.reflect.Method confirm=MainActivity.class.getDeclaredMethod("confirmRestore",JSONObject.class);confirm.setAccessible(true);final JSONObject transfer=desktop;
            ui(()->{try{confirm.invoke(activity,transfer);}catch(Exception error){throw new RuntimeException(error);}});idle();check(test.getUiAutomation().getRootInActiveWindow()!=null&&!test.getUiAutomation().getRootInActiveWindow().findAccessibilityNodeInfosByText("从电脑合并收藏？").isEmpty(),"desktop migration confirmation is shown");
            test.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);idle();check(state().equals(first),"canceling the migration confirmation changes no data");
            try(Library library=new Library(context)){JSONObject changed=new JSONObject();Json.put(changed,"personalRating",1);library.updateEntry(matrix,changed);}
            ui(()->{try{confirm.invoke(activity,transfer);}catch(Exception error){throw new RuntimeException(error);}});idle();
            android.view.accessibility.AccessibilityNodeInfo root=test.getUiAutomation().getRootInActiveWindow();boolean clicked=false;
            if(root!=null)for(android.view.accessibility.AccessibilityNodeInfo node:root.findAccessibilityNodeInfosByText("确认"))if(node.getText()!=null&&node.getText().toString().equals("确认"))clicked=node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK);
            check(clicked,"desktop import is confirmed through the native dialog action");
            await(()->{try(Library library=new Library(context)){if(library.get(matrix).entry.optDouble("personalRating")!=8.5)throw new AssertionError("desktop rating not yet imported");}});check(true,"native confirmation completes the real asynchronous merge");
            // The earlier pre-import snapshot is compared for shape, not reused as the active recovery point.
            check(before.contains("TV-only migration preservation"),"pre-import snapshot contains existing TV-only data");
            Json.put(report,"result","passed");return checks;
        }catch(Exception|AssertionError error){Json.put(report,"result","failed");Json.put(report,"error",error.toString());throw error;}
        finally{
            if(activity!=null){ui(activity::finish);test.waitForIdleSync();}backup.restore(original);
            Json.put(report,"checks",new JSONArray(checks));Json.put(report,"apiLevel",android.os.Build.VERSION.SDK_INT);Json.put(report,"physicalTelevisionVerified",false);
            try(FileOutputStream out=new FileOutputStream(new File(context.getFilesDir(),"desktop-transfer-report.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}
        }
    }
}
