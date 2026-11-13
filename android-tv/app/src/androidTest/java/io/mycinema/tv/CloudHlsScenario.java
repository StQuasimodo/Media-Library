package io.mycinema.tv;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import java.io.*;
import java.util.*;
import java.util.regex.*;
import java.util.concurrent.*;
import okhttp3.*;
import org.json.JSONObject;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.interfaces.IMedia;

/** Synthetic HTTPS cloud graph through real production relay and real API22 LibVLC. */
final class CloudHlsScenario {
    private final Instrumentation test;private final Context context;private PlayerActivity activity;
    CloudHlsScenario(Instrumentation test){this.test=test;context=test.getTargetContext();}
    private static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
    interface Condition{boolean ready()throws Exception;}
    private void await(Condition condition,String message)throws Exception {long end=System.currentTimeMillis()+25000;while(System.currentTimeMillis()<end){if(condition.ready())return;Thread.sleep(200);}throw new AssertionError(message);}
    private PlaybackController controller()throws Exception {java.lang.reflect.Field field=PlayerActivity.class.getDeclaredField("controller");field.setAccessible(true);return (PlaybackController)field.get(activity);}
    private MediaPlayer player()throws Exception {PlaybackController controller=controller();return controller==null?null:controller.engine();}
    private CloudHlsRelay relay()throws Exception {java.lang.reflect.Field field=PlaybackController.class.getDeclaredField("hlsRelay");field.setAccessible(true);return (CloudHlsRelay)field.get(controller());}
    private int frames()throws Exception {IMedia media=player().getMedia();if(media==null)return 0;try{IMedia.Stats stats=media.getStats();return stats==null?0:stats.displayedPictures;}finally{media.release();}}
    private View label(View view,String text){if(view instanceof TextView&&((TextView)view).getText().toString().equals(text))return view;if(view instanceof ViewGroup)for(int n=0;n<((ViewGroup)view).getChildCount();n++){View found=label(((ViewGroup)view).getChildAt(n),text);if(found!=null)return found;}return null;}
    private JSONObject fixture(String fault)throws Exception {try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url("http://10.0.2.2:8765/"+(fault==null?"":"control?fault="+fault)).build()).execute()){check(response.code()==200,"cloud fixture control");return Json.object(response.body().string());}}
    private Response request(MediaSources.Lease endpoint,String method,String url,String range,boolean auth)throws Exception {Request.Builder request=new Request.Builder().url(url).method(method,null);if(auth)request.header("Authorization",endpoint.headers.get("Authorization"));if(range!=null)request.header("Range",range);return MediaSources.HTTP.newCall(request.build()).execute();}
    private String manifest(MediaSources.Lease endpoint,String url)throws Exception {try(Response response=request(endpoint,"GET",url,null,true)){check(response.code()==200,"authenticated rewritten playlist");String value=response.body().string();check(!value.contains("Signature=")&&!value.contains("Expires=")&&!value.contains("quark.cn")&&!value.contains("cloud-fixture-private"),"decoder playlist contains only opaque loopback routes");return value;}}
    private String firstUri(String playlist){for(String line:playlist.split("\n"))if(!line.isEmpty()&&!line.startsWith("#"))return line;throw new AssertionError("playlist reference required");}
    private byte[] range(MediaSources.Lease endpoint,String url)throws Exception {try(Response response=request(endpoint,"GET",url,"bytes=0-127",true)){check(response.code()==206&&response.header("Content-Range","").startsWith("bytes 0-127/"),"cloud child supports exact Range");byte[] bytes=response.body().bytes();check(bytes.length==128,"cloud range length");return bytes;}}
    private byte[] span(MediaSources.Lease endpoint,String url)throws Exception {try(Response response=request(endpoint,"GET",url,"bytes=1000-201000",true)){check(response.code()==206&&response.header("Content-Range","").startsWith("bytes 1000-201000/"),"cloud long range is exact");byte[] bytes=response.body().bytes();check(bytes.length==200001,"cloud long range length");return bytes;}}
    private void cloudFault(String parameters)throws Exception {try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url("http://10.0.2.2:8765/control?"+parameters).build()).execute()){check(response.code()==200,"cloud negative fixture mode");}}
    private void rejectsChangedGraphAndUnsafeBinary(MediaSources sources,MediaSources.Entry video,String selector,JSONObject report)throws Exception {
        for(String fault:new String[]{"changed","disguised","redirect"}){
            try(CloudHlsRelay relay=new CloudHlsRelay(sources,video.json(),selector);NetworkScope scope=new NetworkScope()){
                relay.prepare(scope);MediaSources.Lease endpoint=relay.endpoint();String child=firstUri(manifest(endpoint,endpoint.url.toString()));String media=manifest(endpoint,child);Matcher map=Pattern.compile("URI=\"([^\"]+)\"").matcher(media);check(map.find(),"negative test init route");String init=map.group(1);
                if(fault.equals("changed")){range(endpoint,init);cloudFault("fault=cloud_expire&cloudShape=changed");}else cloudFault("cloudResource="+fault);
                try(Response response=request(endpoint,"GET",init,"bytes=0-127",true)){check(response.code()==502&&response.body().bytes().length==0,"unsafe or changed cloud content rejected: "+fault);}
            }finally{cloudFault("cloudShape=normal&cloudResource=normal&fault=none");}
        }
        Json.put(report,"cloudHlsChangedTimelineRejected",true);Json.put(report,"cloudHlsDisguisedPlaylistRejected",true);Json.put(report,"cloudHlsCrossOriginRedirectRejected",true);
    }
    private void protocol(MediaSources sources,MediaSources.Entry video,String selector,JSONObject report)throws Exception {
        MediaSources.Lease endpoint;
        try(CloudHlsRelay relay=new CloudHlsRelay(sources,video.json(),selector);NetworkScope scope=new NetworkScope()){
            relay.prepare(scope);endpoint=relay.endpoint();
            try(Response response=request(endpoint,"GET",endpoint.url.toString(),null,false)){check(response.code()==401,"unauthenticated HLS root rejected");}
            String master=manifest(endpoint,endpoint.url.toString()),child=firstUri(master);check(child.startsWith("http://127.0.0.1:"),"local HLS variant route");String media=manifest(endpoint,child);
            Matcher map=Pattern.compile("#EXT-X-MAP:.*URI=\"([^\"]+)\"").matcher(media);check(map.find(),"fMP4 initialization segment rewritten");String init=map.group(1);byte[] before=range(endpoint,init);
            try(Response response=request(endpoint,"HEAD",init,null,true)){check(response.code()==200&&response.body().bytes().length==0&&Long.parseLong(response.header("Content-Length"))>=128,"cloud child HEAD reports full size");}
            int cacheQueries=fixture(null).optInt("cloudQueries"),count=0;String segment=firstUri(media);
            for(String line:media.split("\n"))if(!line.isEmpty()&&!line.startsWith("#")){range(endpoint,line);if(++count==8)break;}
            check(count==8&&Arrays.equals(before,range(endpoint,init)),"evicted init resource remains byte exact on revisit");
            check(fixture(null).optInt("cloudQueries")==cacheQueries,"LRU cache miss must not refresh a still-valid cloud root");Json.put(report,"cloudHlsCacheEvictionReusesRoot",true);
            int queries=fixture(null).optInt("cloudQueries");fixture("cloud_expire");byte[] renewed=range(endpoint,init);JSONObject state=fixture(null);
            check(Arrays.equals(before,renewed),"expired cloud URL renewal is byte exact");check(state.optInt("cloudQueries")==queries+1&&state.optInt("cloudExpiredReplies")>=1,"expired child obtains one fresh cloud root then reconstructs its lineage");Json.put(report,"cloudHlsRootRefreshesAfter403",state.optInt("cloudQueries")-queries);
            check(master.equals(manifest(endpoint,endpoint.url.toString()))&&media.equals(manifest(endpoint,child)),"renewal retains stable decoder routes and timeline");
            try(Response response=request(endpoint,"GET",endpoint.url+"?url=https://example.invalid/",null,true)){check(response.code()==404,"HLS endpoint cannot become arbitrary URL proxy");}
            byte[] other=range(endpoint,segment);queries=fixture(null).optInt("cloudQueries");fixture("cloud_expire_pair");ExecutorService pair=Executors.newFixedThreadPool(2);
            try{
                Future<byte[]> a=pair.submit(()->range(endpoint,init)),b=pair.submit(()->range(endpoint,segment));
                check(Arrays.equals(before,a.get(15,TimeUnit.SECONDS))&&Arrays.equals(other,b.get(15,TimeUnit.SECONDS)),"distinct expired child resources both retain their exact bytes");
                state=fixture(null);check(state.optInt("cloudExpiredReplies")==2&&state.optInt("cloudQueries")==queries+1,"concurrent different child 403 responses renew their common root exactly once");
                Json.put(report,"cloudHlsConcurrentExpirySingleRefresh",true);
            }finally{pair.shutdownNow();fixture("none");}
            byte[] baseline=span(endpoint,segment);queries=fixture(null).optInt("cloudQueries");int recoveries=relay.recoveries();fixture("cloud_drop_expire");byte[] resumed=span(endpoint,segment);state=fixture(null);
            check(Arrays.equals(baseline,resumed)&&state.optInt("cloudDrops")==1&&state.optInt("cloudQueries")==queries+1&&relay.recoveries()==recoveries+1,"mid-body cloud drop plus expired URL resumes byte-exactly once");Json.put(report,"cloudHlsByteExactDropAndExpiry",true);fixture("none");
            check(state.optInt("cloudHeaderErrors")==0,"source Cookie/Referer/UA forwarded while local Basic credentials never reach upstream");
            Json.put(report,"cloudHlsByteExactRenewal",true);Json.put(report,"cloudHlsOpaqueAuthenticatedRoutes",true);
        }
        boolean revoked=false;try(Response ignored=request(endpoint,"GET",endpoint.url.toString(),null,true)){}catch(IOException expected){revoked=true;}check(revoked,"closed cloud session revokes its loopback endpoint");fixture("none");
        MediaSources.Lease original=sources.resolveForPlayback(video.json());try(Response response=request(original,"GET",original.url.toString(),"bytes=1000-1063",true)){check(response.code()==206&&response.body().bytes().length==64,"cloud close preserves original Quark WebDAV source");}
    }
    private void cancellation(MediaSources sources,MediaSources.Entry video,String selector,JSONObject report)throws Exception {
        ExecutorService reader=Executors.newSingleThreadExecutor();CloudHlsRelay relay=new CloudHlsRelay(sources,video.json(),selector);
        try(NetworkScope scope=new NetworkScope()){
            relay.prepare(scope);MediaSources.Lease endpoint=relay.endpoint();String child=firstUri(manifest(endpoint,endpoint.url.toString()));int starts=fixture(null).optInt("cloudSlowManifestStarts");fixture("cloud_slow_manifest");
            Future<Boolean> pending=reader.submit(()->{try(Response response=request(endpoint,"GET",child,null,true)){response.body().bytes();return false;}catch(IOException expected){return true;}});
            await(()->fixture(null).optInt("cloudSlowManifestStarts")>starts,"child manifest body is actually blocked upstream");
            long start=android.os.SystemClock.elapsedRealtime();test.runOnMainSync(relay::close);long elapsed=android.os.SystemClock.elapsedRealtime()-start;
            check(elapsed<1500&&pending.get(3,TimeUnit.SECONDS),"closing a cloud relay cancels blocked manifest IO without waiting for graph lock/network timeout");
            Json.put(report,"cloudHlsBlockedManifestCancellationMs",elapsed);Json.put(report,"cloudHlsBlockedManifestCancelled",true);
        }finally{relay.close();reader.shutdownNow();fixture("none");}
    }
    private static long diskBytes(File directory){File[] children=directory.listFiles();long count=0;if(children!=null)for(File file:children)count+=file.isDirectory()?diskBytes(file):file.length();return count;}
    private void nativeContinuity(JSONObject report)throws Exception {
        MediaPlayer engine=player();CloudHlsRelay live=relay();int recoveries=live.recoveries(),before=frames(),queries=fixture(null).optInt("cloudQueries");cloudFault("fault=cloud_drop_expire&cloudDropAtMs=60000");
        test.runOnMainSync(()->engine.setTime(60000));
        await(()->fixture(null).optInt("cloudDrops")==1&&live.recoveries()==recoveries+1&&player()==engine&&engine.isPlaying()&&engine.getTime()>=59500&&engine.getTime()<68000&&frames()>before,"same native HLS decoder renders after mid-fragment drop, expired URL and seek");
        check(fixture(null).optInt("cloudQueries")==queries+1,"native cloud drop and expired fragment renew root once");Json.put(report,"cloudHlsNativeDropAndExpiryVerified",true);fixture("none");
        long start=android.os.SystemClock.elapsedRealtime(),startTime=engine.getTime(),last=startTime,cpu=android.os.Process.getElapsedCpuTime();int firstFrames=frames(),lastFrames=firstFrames;
        long diskBefore=diskBytes(context.getFilesDir())+diskBytes(context.getCacheDir());android.os.Debug.MemoryInfo memory=new android.os.Debug.MemoryInfo();android.os.Debug.getMemoryInfo(memory);int firstPss=memory.getTotalPss(),maximumPss=firstPss;
        IMedia source=engine.getMedia();int firstLost;try{firstLost=source.getStats().lostPictures;}finally{source.release();}
        while(android.os.SystemClock.elapsedRealtime()-start<90000){
            Thread.sleep(5000);long current=engine.getTime();int currentFrames=frames();check(player()==engine&&engine.isPlaying()&&current>last&&currentFrames>lastFrames,"HLS continuous playback advances time and actual displayed frames on every five-second sample");last=current;lastFrames=currentFrames;
            android.os.Debug.getMemoryInfo(memory);maximumPss=Math.max(maximumPss,memory.getTotalPss());
        }
        check(last-startTime>=85000,"ninety-second cloud playback advances at least eighty-five seconds of media time");
        source=engine.getMedia();int lost;try{lost=source.getStats().lostPictures-firstLost;}finally{source.release();}
        JSONObject state=fixture(null);check(state.optInt("cloudUnboundedGets")==0&&state.optInt("maxCloudRangeBytes")<=MediaTransfer.SEGMENT_BYTES,"all cloud binary upstream requests stay within bounded closed Ranges");
        long growth=diskBytes(context.getFilesDir())+diskBytes(context.getCacheDir())-diskBefore;check(growth<262144,"HLS streaming does not grow private files/cache with movie segments");
        Json.put(report,"cloudHlsContinuousWallMs",android.os.SystemClock.elapsedRealtime()-start);Json.put(report,"cloudHlsContinuousAdvanceMs",last-startTime);Json.put(report,"cloudHlsContinuousDisplayedPictures",lastFrames-firstFrames);Json.put(report,"cloudHlsContinuousLostPictures",lost);
        Json.put(report,"cloudHlsProcessCpuMs",android.os.Process.getElapsedCpuTime()-cpu);Json.put(report,"cloudHlsStartPssKiB",firstPss);Json.put(report,"cloudHlsEndPssKiB",memory.getTotalPss());Json.put(report,"cloudHlsMaximumSampledPssKiB",maximumPss);Json.put(report,"cloudHlsPrivateFilesAndCacheGrowthBytes",growth);Json.put(report,"cloudHlsMaximumUpstreamRangeBytes",state.optInt("maxCloudRangeBytes"));
    }
    private void open(String key,String selector)throws Exception {activity=(PlayerActivity)test.startActivitySync(new Intent(context,PlayerActivity.class).putExtra("mediaKey",key).putExtra("cloudVariant",selector).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}
    void run(MediaSources.Entry video,String key,JSONObject report)throws Exception {
        MediaSources sources=new MediaSources(context);String selector="";for(QuarkCloudVersions.Version version:sources.cloudVersions(video.json()))if(version.canTrial())selector=version.selector();check(!selector.isEmpty(),"fixture ready HLS candidate");final String variant=selector;
        long original;try(MediaCatalog catalog=new MediaCatalog(context)){original=catalog.position(key);}new CloudPlaybackProgress(context).save(key,variant,0,180000);
        try{
            Json.put(report,"cloudHlsPhase","protocol");protocol(sources,video,variant,report);rejectsChangedGraphAndUnsafeBinary(sources,video,variant,report);cancellation(sources,video,variant,report);Json.put(report,"cloudHlsPhase","native-open");open(key,variant);
            await(()->player()!=null&&player().isPlaying()&&player().getTime()>1500&&frames()>0,"cloud HLS/fMP4 really decodes and displays frames");
            IMedia media=player().getMedia();try{check(media.getUri().getHost().equals("127.0.0.1"),"decoder consumes only local HLS");IMedia.Stats stats=media.getStats();check(stats!=null&&stats.decodedVideo>0&&stats.decodedAudio>0,"HLS actual video and audio decode counters");Json.put(report,"cloudHlsDecodedVideo",stats.decodedVideo);Json.put(report,"cloudHlsDecodedAudio",stats.decodedAudio);}finally{media.release();}
            String info=PlayerActivity.playbackInfoText(player());Json.put(report,"cloudHlsActualTrackInfo",info);check(info.contains("1920 × 1080"),"HLS runtime dimensions from demuxer rather than filename/tier");
            Json.put(report,"cloudHlsPhase","native-drop-and-continuity");nativeContinuity(report);Json.put(report,"cloudHlsPhase","native-seek-pause-resume");
            int before=frames();test.runOnMainSync(()->{try{player().setTime(40000);}catch(Exception error){throw new IllegalStateException(error);}});
            await(()->player().getTime()>=39500&&player().getTime()<48000&&frames()>before,"HLS seek settles near target with new frames");Json.put(report,"cloudHlsPostSeekMs",player().getTime());
            test.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);await(()->controller().snapshot().state==PlaybackController.State.PAUSED&&!player().isPlaying(),"cloud pause through remote");
            long held=player().getTime();Thread.sleep(800);check(Math.abs(player().getTime()-held)<1000,"cloud paused clock remains stable");MediaPlayer previous=player();
            test.runOnMainSync(()->{View reconnect=label(activity.getWindow().getDecorView(),"重新连接");check(reconnect!=null&&reconnect.performClick(),"cloud remote reconnect");});
            await(()->player()!=null&&player()!=previous&&controller().snapshot().state==PlaybackController.State.PAUSED&&Math.abs(player().getTime()-held)<2000,"cloud reconnect restores position and pause state");
            test.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);await(()->player().isPlaying()&&player().getTime()>held+500&&frames()>0,"cloud resumes with new frames after paused reconnect");
            Bitmap shot=test.getUiAutomation().takeScreenshot();try(FileOutputStream output=new FileOutputStream(new File(context.getFilesDir(),"q03-cloud-hls-playing.png"))){shot.compress(Bitmap.CompressFormat.PNG,100,output);}shot.recycle();
            test.runOnMainSync(activity::finish);test.waitForIdleSync();activity=null;
            await(()->new CloudPlaybackProgress(context).position(key,variant)>=39000,"separate cloud progress survives Activity close");long saved=new CloudPlaybackProgress(context).position(key,variant);
            open(key,variant);await(()->player()!=null&&player().isPlaying()&&player().getTime()>=saved-1000&&frames()>0,"cloud activity reopens and resumes saved trial progress");
            test.runOnMainSync(activity::finish);test.waitForIdleSync();activity=null;
            try(MediaCatalog catalog=new MediaCatalog(context)){check(catalog.position(key)==original&&!catalog.get(key).toString().contains("_cloudVariant")&&!catalog.get(key).toString().contains("cloud-fixture-private"),"original progress and persistent media identity remain unchanged");}
            check(fixture(null).optInt("cloudHeaderErrors")==0,"all decoder child requests retain correct credential boundary");
            Json.put(report,"cloudPlaybackVerified",true);Json.put(report,"cloudHlsSeekPauseResume",true);Json.put(report,"cloudOriginalProgressPreserved",true);Json.put(report,"cloudHlsSavedTrialPositionMs",saved);Json.put(report,"cloudHlsPhysicalTvVerified",false);Json.put(report,"cloudHlsRealAccountVerified",false);Json.put(report,"cloudHlsPhase","complete");
        }catch(Throwable failure){
            try{if(activity!=null&&controller()!=null){Json.put(report,"cloudHlsFailureState",controller().snapshot().state.toString());if(player()!=null){Json.put(report,"cloudHlsFailureNativeMs",player().getTime());Json.put(report,"cloudHlsFailureDisplayedPictures",frames());}}}catch(Throwable ignored){}
            throw failure;
        }finally{if(activity!=null){test.runOnMainSync(activity::finish);test.waitForIdleSync();activity=null;}fixture("none");}
    }
}
