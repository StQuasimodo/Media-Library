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
    private int frames()throws Exception {IMedia media=player().getMedia();if(media==null)return 0;try{IMedia.Stats stats=media.getStats();return stats==null?0:stats.displayedPictures;}finally{media.release();}}
    private View label(View view,String text){if(view instanceof TextView&&((TextView)view).getText().toString().equals(text))return view;if(view instanceof ViewGroup)for(int n=0;n<((ViewGroup)view).getChildCount();n++){View found=label(((ViewGroup)view).getChildAt(n),text);if(found!=null)return found;}return null;}
    private JSONObject fixture(String fault)throws Exception {try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url("http://10.0.2.2:8765/"+(fault==null?"":"control?fault="+fault)).build()).execute()){check(response.code()==200,"cloud fixture control");return Json.object(response.body().string());}}
    private Response request(MediaSources.Lease endpoint,String method,String url,String range,boolean auth)throws Exception {Request.Builder request=new Request.Builder().url(url).method(method,null);if(auth)request.header("Authorization",endpoint.headers.get("Authorization"));if(range!=null)request.header("Range",range);return MediaSources.HTTP.newCall(request.build()).execute();}
    private String manifest(MediaSources.Lease endpoint,String url)throws Exception {try(Response response=request(endpoint,"GET",url,null,true)){check(response.code()==200,"authenticated rewritten playlist");String value=response.body().string();check(!value.contains("Signature=")&&!value.contains("Expires=")&&!value.contains("quark.cn")&&!value.contains("cloud-fixture-private"),"decoder playlist contains only opaque loopback routes");return value;}}
    private String firstUri(String playlist){for(String line:playlist.split("\n"))if(!line.isEmpty()&&!line.startsWith("#"))return line;throw new AssertionError("playlist reference required");}
    private byte[] range(MediaSources.Lease endpoint,String url)throws Exception {try(Response response=request(endpoint,"GET",url,"bytes=0-127",true)){check(response.code()==206&&response.header("Content-Range","").startsWith("bytes 0-127/"),"cloud child supports exact Range");byte[] bytes=response.body().bytes();check(bytes.length==128,"cloud range length");return bytes;}}
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
            int queries=fixture(null).optInt("cloudQueries");fixture("cloud_expire");byte[] renewed=range(endpoint,init);JSONObject state=fixture(null);
            check(Arrays.equals(before,renewed),"expired cloud URL renewal is byte exact");check(state.optInt("cloudQueries")==queries+1&&state.optInt("cloudExpiredReplies")>=1,"expired child obtains one fresh cloud root then reconstructs its lineage");
            check(master.equals(manifest(endpoint,endpoint.url.toString()))&&media.equals(manifest(endpoint,child)),"renewal retains stable decoder routes and timeline");
            try(Response response=request(endpoint,"GET",endpoint.url+"?url=https://example.invalid/",null,true)){check(response.code()==404,"HLS endpoint cannot become arbitrary URL proxy");}
            check(state.optInt("cloudHeaderErrors")==0,"source Cookie/Referer/UA forwarded while local Basic credentials never reach upstream");
            Json.put(report,"cloudHlsByteExactRenewal",true);Json.put(report,"cloudHlsRootRefreshesAfter403",state.optInt("cloudQueries")-queries);Json.put(report,"cloudHlsOpaqueAuthenticatedRoutes",true);
        }
        boolean revoked=false;try(Response ignored=request(endpoint,"GET",endpoint.url.toString(),null,true)){}catch(IOException expected){revoked=true;}check(revoked,"closed cloud session revokes its loopback endpoint");fixture("none");
        MediaSources.Lease original=sources.resolveForPlayback(video.json());try(Response response=request(original,"GET",original.url.toString(),"bytes=1000-1063",true)){check(response.code()==206&&response.body().bytes().length==64,"cloud close preserves original Quark WebDAV source");}
    }
    private void open(String key,String selector)throws Exception {activity=(PlayerActivity)test.startActivitySync(new Intent(context,PlayerActivity.class).putExtra("mediaKey",key).putExtra("cloudVariant",selector).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}
    void run(MediaSources.Entry video,String key,JSONObject report)throws Exception {
        MediaSources sources=new MediaSources(context);String selector="";for(QuarkCloudVersions.Version version:sources.cloudVersions(video.json()))if(version.canTrial())selector=version.selector();check(!selector.isEmpty(),"fixture ready HLS candidate");final String variant=selector;
        long original;try(MediaCatalog catalog=new MediaCatalog(context)){original=catalog.position(key);}new CloudPlaybackProgress(context).save(key,variant,0,180000);
        try{
            protocol(sources,video,variant,report);rejectsChangedGraphAndUnsafeBinary(sources,video,variant,report);open(key,variant);
            await(()->player()!=null&&player().isPlaying()&&player().getTime()>1500&&frames()>0,"cloud HLS/fMP4 really decodes and displays frames");
            IMedia media=player().getMedia();try{check(media.getUri().getHost().equals("127.0.0.1"),"decoder consumes only local HLS");IMedia.Stats stats=media.getStats();check(stats!=null&&stats.decodedVideo>0&&stats.decodedAudio>0,"HLS actual video and audio decode counters");Json.put(report,"cloudHlsDecodedVideo",stats.decodedVideo);Json.put(report,"cloudHlsDecodedAudio",stats.decodedAudio);}finally{media.release();}
            String info=PlayerActivity.playbackInfoText(player());Json.put(report,"cloudHlsActualTrackInfo",info);check(info.contains("1920 × 1080"),"HLS runtime dimensions from demuxer rather than filename/tier");
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
            Json.put(report,"cloudPlaybackVerified",true);Json.put(report,"cloudHlsSeekPauseResume",true);Json.put(report,"cloudOriginalProgressPreserved",true);Json.put(report,"cloudHlsSavedTrialPositionMs",saved);Json.put(report,"cloudHlsPhysicalTvVerified",false);Json.put(report,"cloudHlsRealAccountVerified",false);
        }finally{if(activity!=null){test.runOnMainSync(activity::finish);test.waitForIdleSync();activity=null;}fixture("none");}
    }
}
