package io.mycinema.tv;

import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Field;
import java.util.Arrays;
import java.util.List;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONObject;
import org.videolan.libvlc.MediaPlayer;

/** Real subtitle selection, rendering and cleanup with isolated original-file and DAV fixtures. */
final class ExternalSubtitleScenario {
    private final Instrumentation test;
    private final Context context;
    private final Field controller;
    private PlayerActivity activity;

    ExternalSubtitleScenario(Instrumentation test) throws Exception {
        this.test=test;
        context=test.getTargetContext();
        controller=PlayerActivity.class.getDeclaredField("controller");
        controller.setAccessible(true);
    }

    interface Condition {boolean check() throws Exception;}
    private void require(boolean condition,String description) {
        if(!condition)throw new AssertionError(description);
    }
    private void await(Condition condition,String description) throws Exception {
        long until=android.os.SystemClock.elapsedRealtime()+22000;
        do {
            if(condition.check())return;
            Thread.sleep(250);
        }while(android.os.SystemClock.elapsedRealtime()<until);
        throw new AssertionError("subtitle timeout: "+description);
    }
    private void control(String value) throws Exception {
        try(Response response=MediaSources.HTTP.newCall(new Request.Builder()
            .url("http://10.0.2.2:8765/control?"+value).build()).execute()){
            require(response.code()==200,"subtitle fixture control");
        }
    }
    private MediaPlayer engine() throws Exception {
        PlaybackController playback=(PlaybackController)controller.get(activity);
        return playback==null?null:playback.engine();
    }
    private void launch(MediaSources.Entry video) throws Exception {
        try(MediaCatalog catalog=new MediaCatalog(context)){
            catalog.put(video,"");
            catalog.progress(video.key(),0,0);
        }
        activity=(PlayerActivity)test.startActivitySync(new Intent(context,PlayerActivity.class)
            .putExtra("mediaKey",video.key()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    private void finish() {
        if(activity==null)return;
        test.runOnMainSync(activity::finish);
        test.waitForIdleSync();
        activity=null;
    }
    private boolean styledDialog(String label,String screenshot) throws Exception {
        AccessibilityNodeInfo root=test.getUiAutomation().getRootInActiveWindow();
        if(root==null||root.findAccessibilityNodeInfosByText(label).isEmpty())return false;
        Bitmap image=test.getUiAutomation().takeScreenshot();
        if(image==null)return false;
        try{
            int surface=0,focus=0;
            for(int y=image.getHeight()/8;y<image.getHeight()*7/8;y+=2){
                for(int x=image.getWidth()/8;x<image.getWidth()*7/8;x+=2){
                    int pixel=image.getPixel(x,y);
                    if(pixel==0xff171a21)surface++;
                    if(pixel==0xff8ab4ff)focus++;
                }
            }
            if(surface<1000||focus<35)return false;
            try(FileOutputStream out=new FileOutputStream(new File(context.getFilesDir(),screenshot))){
                image.compress(Bitmap.CompressFormat.PNG,100,out);
            }
            return true;
        }finally{image.recycle();}
    }
    private boolean painted(int red,int green,int blue,String screenshot) throws Exception {
        Bitmap image=test.getUiAutomation().takeScreenshot();
        if(image==null)return false;
        try {
            int count=0,w=image.getWidth(),h=image.getHeight();
            for(int y=h*63/100;y<h*84/100;y+=2)for(int x=w/5;x<w*4/5;x+=2){
                int pixel=image.getPixel(x,y);
                if(Math.abs(Color.red(pixel)-red)<15&&Math.abs(Color.green(pixel)-green)<15
                    &&Math.abs(Color.blue(pixel)-blue)<15)count++;
            }
            if(count<35)return false;
            try(FileOutputStream out=new FileOutputStream(new File(context.getFilesDir(),screenshot))){
                image.compress(Bitmap.CompressFormat.PNG,100,out);
            }
            return true;
        }finally{image.recycle();}
    }
    private boolean noCopies() {
        File[] files=new File(context.getCacheDir(),"playback-subtitles").listFiles();
        return files==null||files.length==0;
    }
    private static MediaSources.Entry entry(String id,String name) {
        return new MediaSources.Entry("quark",id,name,"test-dir",false,100);
    }

    void run(JSONObject report) throws Exception {
        MediaSources.Entry exact=entry("exact","影片.srt");
        MediaSources.Entry chinese=entry("zh","影片.zh-CN.ass");
        MediaSources.Entry other=entry("other","影片 2.zh-CN.ass");
        require(SubtitleFiles.automatic("影片.mkv",Arrays.asList(other,chinese,exact))==exact,
            "exact stem outranks language suffix");
        require(SubtitleFiles.automatic("影片.mkv",Arrays.asList(other,chinese))==chinese,
            "language suffix is allowed without matching another episode");
        require(SubtitleFiles.automatic("影片.mkv",Arrays.asList(exact,entry("tie","影片.ass")))==null,
            "equally ranked sidecars leave the choice to the viewer");

        QuarkDavManager manager=CinemaApplication.dav(context);
        MediaSources sources=new MediaSources(context);
        control("mode=bridge_tree&subtitles=on");
        try {
            manager.enable("tv-root","字幕测试");
            List<MediaSources.Entry> directory=sources.list("quark","season2");
            MediaSources.Entry video=null;
            for(MediaSources.Entry file:directory)if(file.video())video=file;
            require(video!=null,"controlled season video is present");
            launch(video);
            await(()->engine()!=null&&engine().isPlaying()&&engine().getSpuTrack()>=0
                && painted(239,83,183,"q04-auto-subtitle.png"),"matched ASS text is drawn");

            MediaPlayer before=engine();
            MediaPlayer.TrackDescription[] audioTracks=before.getAudioTracks();
            require(audioTracks!=null&&audioTracks.length>=2,"manual switching fixture has multiple audio tracks");
            int alternateAudio=audioTracks[audioTracks.length-1].id;
            test.runOnMainSync(()->before.setAudioTrack(alternateAudio));
            await(()->engine().getAudioTrack()==alternateAudio,"select alternate audio before replacing subtitles");
            test.runOnMainSync(()->before.setTime(20000));
            await(()->engine().getTime()>=19000,"seek before picking a different subtitle");
            test.sendKeyDownUpSync(KeyEvent.KEYCODE_MENU);
            await(()->styledDialog("播放选项","q06-playback-options.png"),"playback options use the Cinema palette and visible focus");
            test.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN);
            test.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN);
            test.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
            await(()->styledDialog("选择同目录字幕","q07-subtitle-picker.png"),"subtitle picker uses the Cinema palette and visible focus");
            test.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN);
            test.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN);
            test.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
            await(()->engine()!=null&&engine()!=before&&engine().isPlaying()&&engine().getTime()>=19000
                &&engine().getAudioTrack()==alternateAudio
                &&engine().getSpuTrack()>=0&&painted(242,162,40,"q05-manual-subtitle.png"),
                "manual ASS text replaces matching subtitle at the same playback position");
            finish();
            await(this::noCopies,"Quark subtitle copies are removed on exit");

            new DualSubtitleScenario(test).run(video);
            Json.put(report,"dualSubtitleFourCombinationsVerified",true);

            MediaSources.Entry external=null;
            for(MediaSources.Entry file:sources.list("webdav",sources.root("webdav")))if(file.video())external=file;
            require(external!=null,"controlled external DAV video is present");
            launch(external);
            await(()->engine()!=null&&engine().isPlaying()&&engine().getSpuTracksCount()>=2
                &&engine().getSpuTrack()>=0&&!noCopies(),"external WebDAV exact-name SRT is an active native subtitle");
            finish();
            await(this::noCopies,"external DAV subtitle copy is removed on exit");
            Json.put(report,"externalSubtitleMatchingVerified",true);
            Json.put(report,"quarkAutoSubtitleRendered",true);
            Json.put(report,"quarkManualSubtitleRendered",true);
            Json.put(report,"audioSelectionPreservedAcrossSubtitleChange",true);
            Json.put(report,"styledPlaybackDialogsAndDpadVerified",true);
            Json.put(report,"externalDavSrtTrackVerified",true);
            Json.put(report,"subtitleCopiesRemovedOnExit",true);
        }finally{
            finish();
            manager.stop();
            control("mode=normal&subtitles=off");
        }
    }
}
