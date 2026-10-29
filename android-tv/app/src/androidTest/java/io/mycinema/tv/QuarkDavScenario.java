package io.mycinema.tv;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import android.widget.ListView;
import org.json.JSONArray;
import org.json.JSONObject;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.interfaces.IMedia;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import okhttp3.HttpUrl;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/** TV-local conversion, not an external WebDAV fixture masquerading as a Quark mount. */
final class QuarkDavScenario {
    private final Instrumentation test;private final Context context;private final String run;
    private PlayerActivity activity;private MediaBrowserActivity owner;
    private final List<String> checks=new ArrayList<>();
    QuarkDavScenario(Instrumentation test,String run){this.test=test;context=test.getTargetContext();this.run=run;}
    interface Condition{boolean ready() throws Exception;}
    private void check(boolean value,String label){if(!value)throw new AssertionError(label);}
    private void await(Condition condition,String label) throws Exception {long end=System.currentTimeMillis()+25000;while(System.currentTimeMillis()<end){if(condition.ready())return;Thread.sleep(250);}throw new AssertionError(label);}
    private MediaPlayer player(){try{java.lang.reflect.Field field=PlayerActivity.class.getDeclaredField("controller");field.setAccessible(true);PlaybackController controller=(PlaybackController)field.get(activity);return controller==null?null:controller.engine();}catch(Exception error){throw new IllegalStateException(error);}}
    private PlaybackController controller(){try{java.lang.reflect.Field field=PlayerActivity.class.getDeclaredField("controller");field.setAccessible(true);return (PlaybackController)field.get(activity);}catch(Exception error){throw new IllegalStateException(error);}}
    private PlaybackRelay.Session session(){try{java.lang.reflect.Field field=PlaybackController.class.getDeclaredField("davSession");field.setAccessible(true);return (PlaybackRelay.Session)field.get(controller());}catch(Exception error){throw new IllegalStateException(error);}}
    private int frames(){IMedia media=player().getMedia();if(media==null)return 0;try{IMedia.Stats stats=media.getStats();return stats==null?0:stats.displayedPictures;}finally{media.release();}}
    private Response request(MediaSources.Lease endpoint,String method,String url,String depth,String range,boolean auth) throws Exception {
        Request.Builder request=new Request.Builder().url(url);if(auth)request.header("Authorization",endpoint.headers.get("Authorization"));if(depth!=null)request.header("Depth",depth);if(range!=null)request.header("Range",range);
        request.method(method,method.equals("PROPFIND")||method.equals("DELETE")||method.equals("PUT")?RequestBody.create(null,new byte[0]):null);return MediaSources.HTTP.newCall(request.build()).execute();
    }
    private void mode(String mode) throws Exception {try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url("http://10.0.2.2:8765/control?mode="+mode).build()).execute()){check(response.code()==200,"fixture mode");}}
    private JSONObject control(String fault) throws Exception {try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url("http://10.0.2.2:8765/"+(fault==null?"":"control?fault="+fault)).build()).execute()){check(response.code()==200,"fixture control");return Json.object(response.body().string());}}
    private void recovery(MediaSources.Lease endpoint,MediaSources.Lease file,QuarkDavManager manager,JSONObject report) throws Exception {
        byte[] baseline;try(Response response=request(endpoint,"GET",file.url.toString(),null,"bytes=1000-201000",true)){baseline=response.body().bytes();}
        int before=manager.recoveries(),downloads=control("drop_expire").optInt("downloads");
        try(Response response=request(endpoint,"GET",file.url.toString(),null,"bytes=1000-201000",true)){check(response.code()==206&&Arrays.equals(baseline,response.body().bytes()),"drop plus expired lease resumes at exact byte, without loss or duplication");}
        JSONObject state=control(null);check(state.optInt("drops")==1&&state.optInt("downloads")==downloads+1&&manager.recoveries()==before+1,"one interrupted transfer refreshes expired lease once");
        Json.put(report,"byteExactDropAndExpiryRecovery",true);
        control("drop_always");before=manager.recoveries();boolean rejected=false;
        try(Response response=request(endpoint,"GET",file.url.toString(),null,"bytes=1000-201000",true)){response.body().bytes();}catch(java.io.IOException expected){rejected=true;}
        check(rejected&&control(null).optInt("drops")==3&&manager.recoveries()==before+2,"continuous failures stop after two resumptions");
        Json.put(report,"maximumResumptionsPerRequest",2);
        control("bad_resume");before=manager.recoveries();rejected=false;
        try(Response response=request(endpoint,"GET",file.url.toString(),null,"bytes=1000-201000",true)){response.body().bytes();}catch(java.io.IOException expected){rejected=true;}
        check(rejected&&manager.recoveries()==before,"server ignoring resumed Range is rejected instead of corrupting the stream");
        control("none");checks.add("mid-body drop and expired URL recover byte-exactly; continuous drops stop at two resumptions; ignored Range never appends a wrong body or HTTP error page");
    }
    private View label(View view,String wanted){if(view instanceof TextView&&((TextView)view).getText().toString().equals(wanted))return view;if(view instanceof ViewGroup)for(int n=0;n<((ViewGroup)view).getChildCount();n++){View result=label(((ViewGroup)view).getChildAt(n),wanted);if(result!=null)return result;}return null;}
    private ListView folderList(View view){if(view instanceof ListView)return (ListView)view;if(view instanceof ViewGroup)for(int n=0;n<((ViewGroup)view).getChildCount();n++){ListView found=folderList(((ViewGroup)view).getChildAt(n));if(found!=null)return found;}return null;}
    private boolean firstFolderContains(String name){ListView list=folderList(owner.getWindow().getDecorView());return list!=null&&list.getAdapter()!=null&&list.getAdapter().getCount()>0&&list.getAdapter().getItem(0).toString().contains(name);}
    private void write(JSONObject report) throws Exception {try(FileOutputStream file=new FileOutputStream(new File(context.getFilesDir(),"tv-quark-dav-report.json"))){file.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}}
    void run() throws Exception {
        JSONObject report=new JSONObject();Json.put(report,"buildRun",run);Json.put(report,"apiLevel",android.os.Build.VERSION.SDK_INT);QuarkDavManager manager=CinemaApplication.dav(context);
        try{
            mode("bridge_tree");MediaSources sources=new MediaSources(context);sources.saveQuark("__puus=tv-playback-fixture");
            owner=(MediaBrowserActivity)test.startActivitySync(new Intent(context,MediaBrowserActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));test.waitForIdleSync();
            test.runOnMainSync(()->{View button=label(owner.getWindow().getDecorView(),"选择夸克文件夹并生成WebDAV");check(button!=null&&button.performClick(),"conversion entry exists and can be selected");});
            await(()->firstFolderContains("影视 & 中文"),"account folder chooser loads");test.runOnMainSync(()->{ListView list=folderList(owner.getWindow().getDecorView());list.performItemClick(list.getChildAt(0),0,list.getItemIdAtPosition(0));});
            await(()->firstFolderContains("第2季 #目录"),"selected folder children load");test.runOnMainSync(()->{View button=label(owner.getWindow().getDecorView(),"将此文件夹转换为WebDAV影视源");check(button!=null&&button.performClick(),"enable chosen Quark folder through native UI");});
            await(()->manager.enabled()&&manager.running()&&manager.rootId().equals("tv-root"),"UI generates local WebDAV without external address input");
            checks.add("native account folder chooser and enable action generate the source without entering an existing WebDAV URL");
            MediaSources.Lease endpoint=manager.endpoint();String base=endpoint.url.toString();check(endpoint.url.host().equals("127.0.0.1"),"loopback only");
            try(Response response=request(endpoint,"PROPFIND",base,"1",null,false)){check(response.code()==401,"authentication required");}
            try(Response response=request(endpoint,"OPTIONS",base,null,null,true)){check(response.code()==200&&"1".equals(response.header("DAV"))&&response.header("Allow").contains("PROPFIND"),"real WebDAV discovery");}
            try(Response response=request(endpoint,"PROPFIND",base,"0",null,true)){byte[] xml=response.body().bytes();check(response.code()==207&&MediaSources.parseDav(xml,endpoint.url,endpoint.url).isEmpty(),"Depth0 includes only self");}
            try(Response response=request(endpoint,"PROPFIND",base,"1",null,true)){byte[] xml=response.body().bytes();List<MediaSources.Entry> entries=MediaSources.parseDav(xml,endpoint.url,endpoint.url);check(response.code()==207&&entries.size()==1&&entries.get(0).directory&&entries.get(0).name.equals("第2季 #目录"),"Depth1 standard XML and Unicode names");check(new String(xml,StandardCharsets.UTF_8).contains("影视 &amp; 中文"),"XML escaping");}
            try(Response response=request(endpoint,"PROPFIND",base,"infinity",null,true)){check(response.code()==403,"unbounded recursion rejected");}
            for(String method:new String[]{"PUT","DELETE","MOVE","COPY","MKCOL"})try(Response response=request(endpoint,method,base,null,null,true)){check(response.code()==405,"read-only "+method);}
            String outside=base+QuarkDavTree.segment(new MediaSources.Entry("quark","outside","不在挂载范围","0",true,0))+"/";
            try(Response response=request(endpoint,"PROPFIND",outside,"1",null,true)){check(response.code()==404,"unselected sibling is inaccessible");}
            checks.add("TV hosts authenticated read-only WebDAV: OPTIONS,207 Depth0/1, Unicode/XML, bounded depth, writes405 and out-of-mount404");
            List<MediaSources.Entry> directories=sources.list("quark",sources.root("quark"));check(directories.size()==1&&directories.get(0).id.equals("season2"),"app lists Quark via local PROPFIND with stable fid");
            List<MediaSources.Entry> files=sources.list("quark",directories.get(0).id);check(files.size()==1&&files.get(0).name.contains("中文 & #")&&!files.get(0).davPath.isEmpty(),"nested file name and persistent relative route");
            MediaSources.Entry video=files.get(0);MediaSources.Lease file=sources.resolveForPlayback(video.json());
            check(file.url.host().equals("127.0.0.1")&&file.headers.containsKey("Authorization"),"Quark playback resolves to television WebDAV, not CDN URL");
            byte[] bytes;try(Response response=request(endpoint,"GET",file.url.toString(),null,"bytes=1000-1063",true)){check(response.code()==206&&response.header("Content-Range").startsWith("bytes 1000-1063/"),"converted source supports Range");bytes=response.body().bytes();check(bytes.length==64,"Range body size");}
            try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url("https://drive-pc.quark.cn/stream/movie.mp4").header("Cookie","__puus=tv-playback-fixture").header("Range","bytes=1000-1063").build()).execute()){check(Arrays.equals(bytes,response.body().bytes()),"converted Range bytes exactly match upstream");}
            try(Response response=request(endpoint,"HEAD",file.url.toString(),null,null,true)){check(response.code()==200&&response.body().bytes().length==0&&Long.parseLong(response.header("Content-Length"))>1024,"HEAD gives real length without body");}
            checks.add("app directory and playback paths use the generated TV WebDAV; nested fid routes, HEAD length and byte-exact206 work");
            recovery(endpoint,file,manager,report);
            Json.put(report,"architectureChecks","running");new PlaybackArchitectureScenario(context).run(file,video,report);Json.put(report,"architectureChecks","passed");
            checks.add("four-MiB sequential transport, exact segment boundary and suffix, HEAD through GET probe, wrong initial Range rejection, concurrent expiry deduplication, underlying API cancellation");
            String key;try(MediaCatalog catalog=new MediaCatalog(context)){JSONObject data=catalog.put(video,"");key=Json.text(data,"key");catalog.progress(key,0,45000);check(Json.text(data,"source").equals("quark")&&!data.toString().contains(endpoint.headers.get("Authorization")),"catalog persists stable identity, not gateway secrets");}
            control("drop_expire");int beforeNativeRecovery=manager.recoveries();
            activity=(PlayerActivity)test.startActivitySync(new Intent(context,PlayerActivity.class).putExtra("mediaKey",key).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));await(()->player()!=null&&player().isPlaying()&&player().getTime()>1500&&frames()>0,"Quark to WebDAV to LibVLC actually displays frames");
            check(control(null).optInt("drops")==1&&manager.recoveries()>beforeNativeRecovery,"native VLC renders after a real stream drop and lease expiry");control("none");Json.put(report,"nativePlaybackAfterDropAndExpiry",true);
            java.lang.reflect.Field owner=PlayerActivity.class.getDeclaredField("controller");owner.setAccessible(true);PlaybackController playback=(PlaybackController)owner.get(activity);check(playback!=null,"controller owns the decoder session");
            IMedia direct=player().getMedia();try{check(direct.getUri().toString().startsWith(base),"LibVLC directly requests the mounted local WebDAV endpoint");}finally{direct.release();}
            Json.put(report,"localForwardingHops",1);
            int before=frames();test.runOnMainSync(()->player().setTime(20000));Thread.sleep(2500);await(()->player().getTime()>=21000&&frames()>before,"converted source seek displays new frames");
            Json.put(report,"postSeekTimeMs",player().getTime());Json.put(report,"displayedPictures",frames());Bitmap screen=test.getUiAutomation().takeScreenshot();try(FileOutputStream image=new FileOutputStream(new File(context.getFilesDir(),"q01-quark-dav-playing.png"))){screen.compress(Bitmap.CompressFormat.PNG,100,image);}screen.recycle();
            long wall=android.os.SystemClock.elapsedRealtime(),startTime=player().getTime(),last=startTime;int startFrames=frames();
            android.os.Debug.MemoryInfo memory=new android.os.Debug.MemoryInfo();android.os.Debug.getMemoryInfo(memory);int startPss=memory.getTotalPss();
            while(android.os.SystemClock.elapsedRealtime()-wall<90000){Thread.sleep(5000);long current=player().getTime();check(player().isPlaying()&&current>last&&frames()>startFrames,"continuous playback advances on every five-second sample");last=current;}
            android.os.Debug.getMemoryInfo(memory);Json.put(report,"continuousPlaybackWallMs",android.os.SystemClock.elapsedRealtime()-wall);Json.put(report,"continuousPlaybackAdvanceMs",last-startTime);Json.put(report,"continuousDisplayedPictures",frames()-startFrames);Json.put(report,"startPssKiB",startPss);Json.put(report,"endPssKiB",memory.getTotalPss());
            checks.add("one-hop authenticated LibVLC playback advances continuously for at least90seconds; five-second clock checks and displayed-frame evidence; start/end PSS recorded, not peak memory");
            Json.put(report,"preExitTimeMs",player().getTime());Json.put(report,"durationMs",player().getLength());
            test.runOnMainSync(activity::finish);test.waitForIdleSync();activity=null;
            await(()->{try(MediaCatalog catalog=new MediaCatalog(context)){return catalog.position(key)>=19000;}},"exit saves Quark progress before gateway restart");
            manager.stop();check(manager.enabled()&&!manager.running(),"stopping server keeps chosen folder");
            MediaSources.Lease restarted=manager.endpoint();check(!restarted.headers.get("Authorization").equals(endpoint.headers.get("Authorization")),"gateway restarts with new credentials");
            try(Response response=request(endpoint,"PROPFIND",restarted.url.toString(),"0",null,true)){check(response.code()==401,"old Basic secret revoked");}
            try(MediaCatalog catalog=new MediaCatalog(context)){check(catalog.position(key)>=19000,"Quark progress survives new connection");JSONObject stored=catalog.get(key);check(!stored.toString().contains("127.0.0.1"),"temporary host/port not stored as media identity");}
            activity=(PlayerActivity)test.startActivitySync(new Intent(context,PlayerActivity.class).putExtra("mediaKey",key).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));await(()->player()!=null&&player().isPlaying()&&player().getTime()>=19000,"resume after gateway URL/password change");Thread.sleep(2000);check(player().getTime()>=21000&&frames()>0,"resumed new gateway advances and renders");
            MediaPlayer previous=player();PlaybackRelay.Session oldSession=session();long reconnectTime=previous.getTime();test.runOnMainSync(()->{View button=label(activity.getWindow().getDecorView(),"重新连接");check(button!=null&&button.performClick(),"native reconnect action");});
            await(()->player()!=null&&player()!=previous&&player().isPlaying()&&player().getTime()>=reconnectTime-1000&&frames()>0,"manual reconnect rebuilds decoder and resumes saved position");Json.put(report,"manualReconnectResumes",true);
            try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url(oldSession.endpoint.url).header("Authorization",oldSession.endpoint.headers.get("Authorization")).header("Range","bytes=1000-1063").build()).execute()){check(response.code()==401,"reconnect revokes only the old playback session");}Json.put(report,"playbackSessionRevoked",true);
            test.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);await(()->controller().snapshot().state==PlaybackController.State.PAUSED&&!player().isPlaying(),"controller paused state");long pausedAt=player().getTime();MediaPlayer pausedEngine=player();
            test.runOnMainSync(()->label(activity.getWindow().getDecorView(),"重新连接").performClick());
            await(()->player()!=null&&player()!=pausedEngine&&controller().snapshot().state==PlaybackController.State.PAUSED&&player().getTime()>=pausedAt-1000,"reconnect restores position and remains paused");
            long held=player().getTime();Thread.sleep(600);check(!player().isPlaying()&&Math.abs(player().getTime()-held)<1000,"paused reconnect does not silently autoplay");Json.put(report,"pausedReconnectPreserved",true);
            test.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);await(()->player().isPlaying(),"resume after paused reconnect");
            test.runOnMainSync(()->{View button=label(activity.getWindow().getDecorView(),"重新连接");for(int n=0;n<3;n++)button.performClick();});
            await(()->player()!=null&&player().isPlaying()&&frames()>0&&controller().snapshot().state==PlaybackController.State.PLAYING,"rapid reconnect keeps only the latest live session");Json.put(report,"rapidReconnectVerified",true);
            PlaybackController stopped=controller();PlaybackRelay.Session endingSession=session();
            test.runOnMainSync(activity::finish);test.waitForIdleSync();activity=null;
            await(()->stopped.snapshot().state==PlaybackController.State.STOPPED&&stopped.engine()==null,"finished Activity releases decoder and publishes stopped state");Thread.sleep(400);check(stopped.engine()==null,"late connection does not recreate decoder");
            try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url(endingSession.endpoint.url).header("Authorization",endingSession.endpoint.headers.get("Authorization")).header("Range","bytes=1000-1063").build()).execute()){check(response.code()==401,"exit revokes stream session");}Json.put(report,"stoppedSessionCannotRestart",true);
            checks.add("real LibVLC renders and seeks Quark-converted WebDAV; saved progress resumes after gateway URL/credentials restart");
            Json.put(report,"result","passed");Json.put(report,"checks",new JSONArray(checks));Json.put(report,"realQuarkAccountVerified",false);Json.put(report,"physicalTelevisionVerified",false);Json.put(report,"actualLocalWebDavServer",true);write(report);
        }catch(Throwable error){Json.put(report,"result","failed");Json.put(report,"checks",new JSONArray(checks));Json.put(report,"errorClass",error.getClass().getSimpleName());Json.put(report,"error",error instanceof AssertionError?error.getMessage():"controlled bridge verification failed");write(report);throw new AssertionError("Quark WebDAV scenario failed: "+error.getClass().getSimpleName(),error);}
        finally{if(activity!=null)test.runOnMainSync(activity::finish);if(owner!=null)test.runOnMainSync(owner::finish);mode("normal");}
    }
}
