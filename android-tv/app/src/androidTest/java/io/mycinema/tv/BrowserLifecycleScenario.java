package io.mycinema.tv;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import java.lang.reflect.Field;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import okhttp3.HttpUrl;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONObject;

/** Real blocked HTTP calls: cancellation must stop reads, not only abandon their UI results. */
final class BrowserLifecycleScenario {
    private final Instrumentation test;private final Context context;
    private MediaBrowserActivity browser;
    BrowserLifecycleScenario(Instrumentation test){this.test=test;context=test.getTargetContext();}
    interface Work {void run(NetworkScope scope) throws Exception;}
    interface Condition {boolean ready() throws Exception;}
    private void check(boolean value,String label){if(!value)throw new AssertionError(label);}
    private void await(Condition condition,String label) throws Exception {long end=System.currentTimeMillis()+5000;while(System.currentTimeMillis()<end){if(condition.ready())return;Thread.sleep(25);}throw new AssertionError("timeout: "+label);}
    private JSONObject control(String fault) throws Exception {
        try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url("http://10.0.2.2:8765/"+(fault==null?"":"control?fault="+fault)).build()).execute()){check(response.code()==200,"fixture control");return Json.object(response.body().string());}
    }
    private Object field(Object owner,String name) throws Exception {Field field=owner.getClass().getDeclaredField(name);field.setAccessible(true);return field.get(owner);}
    private View label(View view,String name){if(view instanceof TextView&&((TextView)view).getText().toString().equals(name))return view;if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++){View found=label(((ViewGroup)view).getChildAt(i),name);if(found!=null)return found;}return null;}
    private long cancelBlocked(String fault,String counter,Work work) throws Exception {
        ExecutorService reader=Executors.newSingleThreadExecutor();NetworkScope scope=new NetworkScope();
        try{
            int previous=control(fault).optInt(counter);
            Future<?> pending=reader.submit(()->{try{work.run(scope);throw new AssertionError("blocked read completed instead of cancellation");}catch(java.io.IOException expected){check(scope.cancelled(),"read failed because its scope was cancelled");}catch(Exception failure){throw new IllegalStateException(failure);}});
            await(()->control(null).optInt(counter)>previous,"upstream actually entered ten-second blocked read");
            long start=android.os.SystemClock.elapsedRealtime();scope.close();pending.get(2,TimeUnit.SECONDS);
            return android.os.SystemClock.elapsedRealtime()-start;
        }finally{scope.close();reader.shutdownNow();control("none");}
    }
    void run(JSONObject report) throws Exception {
        QuarkDavManager manager=CinemaApplication.dav(context);MediaSources sources=new MediaSources(context);
        ExecutorService jobs=null;
        try{
            control("none&mode=bridge_tree");
            check(manager.enabled(),"existing chosen Quark folder retained");
            Json.put(report,"rawDirectoryCancellationMs",cancelBlocked("slow_list","slowListStarts",scope->sources.withScope(scope).rawQuarkList("0")));
            JSONObject config=new JSONObject();Json.put(config,"url","https://api.tmdb.org/dav/");Json.put(config,"user","tv-test");Json.put(config,"password","fixture");
            Json.put(report,"externalDavCancellationMs",cancelBlocked("slow_dav","slowDavStarts",scope->sources.withScope(scope).listDav(config,"https://api.tmdb.org/dav/")));

            // Recreate just the mount's cache. Keep selection, credentials, catalog and progress.
            MediaSources.Entry folder=sources.list("quark",manager.rootId()).get(0);
            MediaSources.Entry video=sources.list("quark",folder.id).get(0);
            manager.stop();MediaSources.Lease endpoint=manager.endpoint();PlaybackRelay server=(PlaybackRelay)field(manager,"server");
            try(PlaybackRelay.Session playback=server.openSession(video.id,HttpUrl.parse(endpoint.url.toString()+video.davPath))){
                Json.put(report,"localDavUpstreamCancellationMs",cancelBlocked("slow_list","slowListStarts",scope->sources.withScope(scope).list("quark",manager.rootId())));
                await(()->server.idle()&&server.activeRequests()==0,"cancelled PROPFIND also stops its server-side upstream read");
                check(manager.running()&&manager.endpoint().url.equals(endpoint.url),"browser cancellation keeps shared DAV running");
                try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url(playback.endpoint.url).header("Authorization",playback.auth).header("Range","bytes=1000-1063").build()).execute()){
                    check(response.code()==206&&response.body().bytes().length==64,"unrelated playback lease still reads after directory cancellation");
                }
            }
            Json.put(report,"browserCancellationKeepsPlaybackSession",true);
            PlaybackRelay.Session directory=server.openDirectorySession(manager.rootId(),endpoint.url);
            try(PlaybackRelay.Session lease=directory){
                try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url(endpoint.url).header("Authorization",lease.auth).build()).execute()){check(response.code()==403,"directory lease cannot read media");}
                try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url(endpoint.url.toString()+video.davPath).header("Authorization",lease.auth).method("PROPFIND",okhttp3.RequestBody.create(null,new byte[0])).build()).execute()){check(response.code()==403,"directory lease cannot list another path");}
            }
            try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url(endpoint.url).header("Authorization",directory.auth).method("PROPFIND",okhttp3.RequestBody.create(null,new byte[0])).build()).execute()){check(response.code()==401,"completed directory lease is revoked");}
            Json.put(report,"directoryLeaseConfinement",true);

            // Destroy the actual Activity during its real scan, then invoke its old UI callback.
            browser=(MediaBrowserActivity)test.startActivitySync(new Intent(context,MediaBrowserActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));test.waitForIdleSync();
            test.runOnMainSync(()->{View open=label(browser.getWindow().getDecorView(),"夸克 WebDAV · 浏览影视源");check(open!=null&&open.performClick(),"open existing Quark mount through UI");});
            await(()->!(Boolean)field(browser,"working")&&label(browser.getWindow().getDecorView(),"扫描此文件夹并匹配收藏")!=null,"browser directory loaded");
            // Five-second cache is deliberately expired, so a scan must contact the upstream.
            Thread.sleep(5100);int previous=control("slow_list").optInt("slowListStarts");
            final MediaBrowserActivity owner=browser;final View[] oldButton=new View[1];
            test.runOnMainSync(()->{oldButton[0]=label(owner.getWindow().getDecorView(),"扫描此文件夹并匹配收藏");check(oldButton[0]!=null&&oldButton[0].performClick(),"start real recursive scan");});
            await(()->control(null).optInt("slowListStarts")>previous,"scan request is blocked");
            jobs=(ExecutorService)field(owner,"jobs");NetworkScope scan=(NetworkScope)field(owner,"taskScope");
            String before;long progress;try(MediaCatalog catalog=new MediaCatalog(context)){before=catalog.get(video.key()).toString();progress=catalog.position(video.key());}
            test.runOnMainSync(owner::finish);test.waitForIdleSync();
            await(()->(Boolean)field(owner,"disposed"),"activity destroyed");
            check(scan.cancelled()&&jobs.awaitTermination(2,TimeUnit.SECONDS),"destroy closes scan calls and terminates worker promptly");
            PlaybackRelay active=(PlaybackRelay)field(manager,"server");await(()->active.idle()&&active.activeRequests()==0,"destroy drains local DAV upstream work");
            test.runOnMainSync(()->oldButton[0].performClick());
            check(jobs.isTerminated(),"destroyed UI cannot submit into a shut-down executor");
            try(MediaCatalog catalog=new MediaCatalog(context)){check(catalog.get(video.key()).toString().equals(before)&&catalog.position(video.key())==progress,"cancelled scan preserves prior association and progress");}
            Json.put(report,"destroyedBrowserCancelsScan",true);Json.put(report,"staleBrowserCallbackIgnored",true);Json.put(report,"cancelledScanPreservesCatalog",true);
        }finally{if(browser!=null)test.runOnMainSync(browser::finish);control("none&mode=normal");}
    }
}
