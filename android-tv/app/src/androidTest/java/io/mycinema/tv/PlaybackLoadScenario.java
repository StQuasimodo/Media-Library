package io.mycinema.tv;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONObject;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.interfaces.IMedia;

/** Uses the real remote file, relay, Activity and LibVLC paths in a disposable emulator. */
final class PlaybackLoadScenario {
    private static final long FIRST_FRAME_LIMIT_MS=12000, OBSERVE_MS=12000;
    private final Instrumentation test;
    private final Context context;
    private final Field controller;
    private final JSONObject report=new JSONObject();
    private PlayerActivity activity;
    private MainActivity anchor;

    PlaybackLoadScenario(Instrumentation test) throws Exception {
        this.test=test;
        context=test.getTargetContext();
        controller=PlayerActivity.class.getDeclaredField("controller");
        controller.setAccessible(true);
    }

    private static void require(boolean condition,String message){
        if(!condition)throw new AssertionError(message);
    }

    private void control(String mode) throws Exception {
        try(Response response=MediaSources.HTTP.newCall(new Request.Builder()
            .url("http://10.0.2.2:8765/control?mode="+mode).build()).execute()){
            require(response.code()==200,"controlled media service did not switch profile");
        }
    }

    private static final class FrameSample {
        long time,buffered;
        int pictures,lost,episodes;
        String state="CONNECTING";
        StreamMetrics.Snapshot stream;
    }

    private FrameSample sample() {
        FrameSample result=new FrameSample();
        test.runOnMainSync(()->{
            try {
                PlaybackController playback=(PlaybackController)controller.get(activity);
                if(playback==null)return;
                result.state=playback.snapshot().state.name();
                result.buffered=playback.rebufferMs();
                result.episodes=playback.bufferEpisodes();
                result.stream=playback.streamSnapshot();
                MediaPlayer engine=playback.engine();
                if(engine==null)return;
                result.time=Math.max(0,engine.getTime());
                IMedia media=engine.getMedia();
                if(media==null)return;
                try {
                    IMedia.Stats stats=media.getStats();
                    if(stats!=null){result.pictures=stats.displayedPictures;result.lost=stats.lostPictures;}
                }finally{media.release();}
            }catch(IllegalAccessException failure){throw new AssertionError(failure);}
        });
        return result;
    }

    private JSONObject measure(String id,String mode,int fps) throws Exception {
        control(mode);
        MediaSources sources=new MediaSources(context);
        QuarkDavManager manager=CinemaApplication.dav(context);
        manager.enable("0","持续播放验证");
        MediaSources.Entry selected=null;
        for(MediaSources.Entry entry:sources.list("quark","0"))if(entry.id.equals(id))selected=entry;
        require(selected!=null,"controlled video is in the mounted directory");
        try(MediaCatalog catalog=new MediaCatalog(context)){
            catalog.put(selected,"");
            catalog.progress(selected.key(),0,0);
        }
        long opened=SystemClock.elapsedRealtime();
        long cpuStart=android.os.Process.getElapsedCpuTime();
        activity=(PlayerActivity)test.startActivitySync(new Intent(context,PlayerActivity.class)
            .putExtra("mediaKey",selected.key()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        FrameSample current=sample();
        while(current.pictures==0&&!current.state.equals("ERROR")
            &&SystemClock.elapsedRealtime()-opened<(mode.equals("load_outage")?22000:FIRST_FRAME_LIMIT_MS)){
            Thread.sleep(200);
            current=sample();
        }
        boolean started=current.pictures>0;
        long start=SystemClock.elapsedRealtime(),firstFrameMs=started?start-opened:-1;
        FrameSample baseline=current;
        long lastNewFrame=start,longestGap=0;
        while(started&&!current.state.equals("ERROR")&&SystemClock.elapsedRealtime()-start<OBSERVE_MS){
            Thread.sleep(200);
            FrameSample next=sample();
            long now=SystemClock.elapsedRealtime();
            longestGap=Math.max(longestGap,now-lastNewFrame);
            if(next.pictures>current.pictures)lastNewFrame=now;
            current=next;
        }
        long wall=SystemClock.elapsedRealtime()-start;
        long advance=Math.max(0,current.time-baseline.time);
        int displayed=Math.max(0,current.pictures-baseline.pictures);
        int lost=Math.max(0,current.lost-baseline.lost);
        boolean smooth=started&&firstFrameMs<=FIRST_FRAME_LIMIT_MS&&wall>=OBSERVE_MS&&advance>=wall*.85
            &&displayed>=wall*fps*.65/1000&&longestGap<1800
            &&!current.state.equals("ERROR");
        JSONObject result=new JSONObject();
        Json.put(result,"fixture",id);
        Json.put(result,"profile",mode);
        Json.put(result,"playbackQuality",smooth?"continuous":started?"stalled_or_dropped":"no_frame");
        Json.put(result,"firstFrameMs",firstFrameMs);
        Json.put(result,"wallMs",wall);
        Json.put(result,"advanceMs",advance);
        Json.put(result,"displayedFrames",displayed);
        Json.put(result,"lostFrames",lost);
        Json.put(result,"longestFrameGapMs",longestGap);
        Json.put(result,"bufferEpisodes",current.episodes);
        Json.put(result,"bufferAfterStartMs",current.buffered);
        Json.put(result,"finalState",current.state);
        android.os.Debug.MemoryInfo memory=new android.os.Debug.MemoryInfo();
        android.os.Debug.getMemoryInfo(memory);
        Json.put(result,"endPssKiB",memory.getTotalPss());
        Json.put(result,"appCpuMs",android.os.Process.getElapsedCpuTime()-cpuStart);
        if(current.stream!=null){
            Json.put(result,"receivedBytes",current.stream.received);
            Json.put(result,"forwardedBytes",current.stream.forwarded);
            Json.put(result,"upstreamRequests",current.stream.responses);
            Json.put(result,"transportRetries",current.stream.retries);
            Json.put(result,"recentForwardedMbps",current.stream.recentMbps());
            JSONObject waits=new JSONObject();
            for(StreamMetrics.Step step:StreamMetrics.Step.values())Json.put(waits,step.name(),current.stream.maxMs(step));
            Json.put(result,"maxWaitMs",waits);
        }
        return result;
    }

    private boolean waitForText(String text) throws InterruptedException {
        long until=SystemClock.elapsedRealtime()+4000;
        do{
            AccessibilityNodeInfo screen=test.getUiAutomation().getRootInActiveWindow();
            if(screen!=null&&!screen.findAccessibilityNodeInfosByText(text).isEmpty())return true;
            Thread.sleep(200);
        }while(SystemClock.elapsedRealtime()<until);
        return false;
    }

    private void verifyDiagnosticDialog() throws Exception {
        test.setInTouchMode(false);
        test.sendKeyDownUpSync(KeyEvent.KEYCODE_MENU);
        require(waitForText("播放选项"),"playback menu did not open");
        for(int row=0;row<7;row++)test.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN);
        test.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
        boolean visible=waitForText("等待上游响应");
        Bitmap image=test.getUiAutomation().takeScreenshot();
        if(image!=null){
            try(FileOutputStream out=new FileOutputStream(new File(context.getFilesDir(),"tv-stream-diagnostics.png"))){
                image.compress(Bitmap.CompressFormat.PNG,100,out);
            }finally{image.recycle();}
        }
        require(visible,"safe stream metrics are not visible");
        require(image!=null,"diagnostics screenshot");
        test.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
        final String[] copied={""};
        test.runOnMainSync(()->{
            android.content.ClipboardManager clipboard=(android.content.ClipboardManager)context.getSystemService(Context.CLIPBOARD_SERVICE);
            android.content.ClipData content=clipboard.getPrimaryClip();
            if(content!=null)copied[0]=String.valueOf(content.getItemAt(0).getText());
        });
        require(copied[0].contains("等待上游响应")&&!copied[0].contains("https://")
            &&!copied[0].contains("__puus")&&!copied[0].contains("load-1080"),"clipboard contains only safe playback metrics");
    }

    private void closePlayer(){
        if(activity==null)return;
        test.runOnMainSync(activity::finish);
        test.waitForIdleSync();
        activity=null;
    }

    private void writeReport() throws Exception {
        try(FileOutputStream out=new FileOutputStream(new File(context.getFilesDir(),"tv-playback-load-report.json"))){
            out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));
        }
    }

    void run(String buildRun) throws Exception {
        Bundle result=new Bundle();
        Json.put(report,"buildRun",buildRun);
        Json.put(report,"apiLevel",android.os.Build.VERSION.SDK_INT);
        Json.put(report,"fixtureOnly",true);
        Json.put(report,"realQuarkAccountVerified",false);
        Json.put(report,"physicalTelevisionVerified",false);
        Json.put(report,"decoderPath","unknown");
        Json.put(report,"result","running");
        try{
            require(java.net.InetAddress.getByName("drive-pc.quark.cn").getHostAddress().equals("10.0.2.2"),
                "disposable emulator must use fixture DNS");
            control("load_clean");
            new MediaSources(context).saveQuark("__puus=tv-playback-fixture");
            anchor=(MainActivity)test.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            JSONObject baseline=measure("load-1080","load_clean",30);
            Json.put(report,"highBitrate1080p",baseline);
            closePlayer();
            writeReport();

            Json.put(report,"hevcMain10Capability",measure("load-4k","load_clean",24));
            closePlayer();
            writeReport();

            JSONObject recovered=measure("load-1080","load_delayed",30);
            Json.put(report,"parallelDelayed1080p",recovered);
            closePlayer();
            writeReport();

            JSONObject delayed=measure("load-1080","load_outage",30);
            boolean reproduced=delayed.optLong("longestFrameGapMs")>=2000
                || delayed.optLong("advanceMs")<delayed.optLong("wallMs")*.75;
            JSONObject waits=delayed.optJSONObject("maxWaitMs");
            reproduced&=waits!=null&&waits.optLong("RESPONSE")>=3000
                &&delayed.optLong("firstFrameMs",-1)>=0;
            Json.put(report,"delayed1080p",delayed);
            Json.put(report,"1080pStallReproduced",reproduced);
            verifyDiagnosticDialog();
            Json.put(report,"diagnosticDialogVerified",true);
            closePlayer();
            writeReport();

            require(baseline.optString("playbackQuality").equals("continuous"),"high-bitrate 1080p failed continuous playback");
            require(recovered.getJSONObject("maxWaitMs").getLong("RESPONSE")>=3000,
                "the improved case must encounter the same upstream delay");
            require(recovered.optString("playbackQuality").equals("continuous"),
                "overlapped ranges did not sustain delayed 1080p");
            require(reproduced,"the delayed range case did not reproduce a measurable stall");
            Json.put(report,"result","passed");
            result.putString("result","passed");
        }catch(Throwable failure){
            Json.put(report,"result","failed");
            Json.put(report,"failure",failure instanceof AssertionError?failure.getMessage():failure.getClass().getSimpleName());
            result.putString("result","failed");
        }finally{
            closePlayer();
            if(anchor!=null)test.runOnMainSync(anchor::finish);
            CinemaApplication.dav(context).stop();
            control("normal");
            writeReport();
        }
        test.finish("passed".equals(result.getString("result"))?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);
    }
}
