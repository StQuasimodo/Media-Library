package io.mycinema.tv;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import java.io.Closeable;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.json.JSONObject;
import org.videolan.libvlc.Dialog;
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;
import org.videolan.libvlc.interfaces.IMedia;

/** Owns a single decoder session. The Activity renders state and handles remote focus only. */
final class PlaybackController implements Closeable {
    enum State {STOPPED,CONNECTING,BUFFERING,PLAYING,PAUSED,ENDED,ERROR}
    static final class Snapshot {
        final State state;final long position,duration;final float buffered;final String message;
        Snapshot(State state,long position,long duration,float buffered,String message){this.state=state;this.position=position;this.duration=duration;this.buffered=buffered;this.message=message;}
    }
    interface Listener {
        void changed(Snapshot snapshot);
        void progress(long position,long duration);
    }
    interface SubtitleList {void ready(List<MediaSources.Entry> entries);}
    interface SubtitleMessage {void show(String message);}
    private static final class SubtitleResumeOptions {
        final int audioTrack;
        final long audioDelay, subtitleDelay;
        SubtitleResumeOptions(MediaPlayer player) {
            audioTrack=player.getAudioTrack();
            audioDelay=player.getAudioDelay();
            subtitleDelay=player.getSpuDelay();
        }
        void restore(MediaPlayer player) {
            player.setAudioTrack(audioTrack);
            player.setAudioDelay(audioDelay);
            player.setSpuDelay(subtitleDelay);
        }
    }
    private final Context context;private final JSONObject file;private final Listener listener;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService connector=Executors.newSingleThreadExecutor();
    private Future<?> connecting;private NetworkScope network;private PlaybackRelay relay;
    private PlaybackRelay.Session davSession;private CloudHlsRelay hlsRelay;
    private NetworkScope subtitleScope;
    private Future<?> subtitleTask;
    private File subtitleFile;
    private String subtitleId="";
    private boolean subtitleChecked, preferExternal=true, subtitlesOff;
    private SubtitleResumeOptions subtitleResumeOptions;
    private LibVLC vlc;private volatile MediaPlayer player;private VLCVideoLayout video;
    private PausedRestore pausedRestore;
    private int generation,ticks,loginAttempts;private long position,duration,restoreAt=-1;
    private boolean restoreFailed,seekAtOpen,loaded,restoreApplied,wantPaused,mutedForRestore,disposed;private float buffered,playbackRate=1f;
    private State state=State.STOPPED;private String message="";
    private boolean playbackStarted;
    private long bufferBegan, bufferedAfterStart;
    private int bufferEpisodes;
    private volatile Snapshot snapshot=new Snapshot(State.STOPPED,0,0,0,"");

    PlaybackController(Context context,JSONObject file,Listener listener){this.context=context.getApplicationContext();this.file=Json.copy(file);this.listener=listener;}
    Snapshot snapshot(){return snapshot;}
    MediaPlayer engine(){return player;}
    private boolean current(int session,MediaPlayer engine){return session==generation&&engine==player&&!disposed;}
    private void publish(){snapshot=new Snapshot(state,position,duration,buffered,message);listener.changed(snapshot);}
    private void state(State state,String message){
        if(this.state!=state){
            long now=android.os.SystemClock.elapsedRealtime();
            if(bufferBegan!=0){bufferedAfterStart+=now-bufferBegan;bufferBegan=0;}
            if(state==State.PLAYING)playbackStarted=true;
            if(state==State.BUFFERING&&playbackStarted){bufferBegan=now;bufferEpisodes++;}
        }
        this.state=state;this.message=message;publish();
    }
    int bufferEpisodes(){return bufferEpisodes;}
    long rebufferMs(){return bufferedAfterStart+(bufferBegan==0?0:android.os.SystemClock.elapsedRealtime()-bufferBegan);}
    StreamMetrics.Snapshot streamSnapshot(){
        if(davSession!=null)return davSession.metrics.snapshot();
        if(hlsRelay!=null)return hlsRelay.metrics().snapshot();
        return relay==null?null:relay.metrics().snapshot();
    }
    private static String stateLabel(State current){
        switch(current){
            case CONNECTING:return "连接中";
            case BUFFERING:return "缓冲中";
            case PLAYING:return "播放中";
            case PAUSED:return "已暂停";
            case ENDED:return "已结束";
            case ERROR:return "出错";
            default:return "已停止";
        }
    }

    String streamDiagnostics(){
        StringBuilder text=new StringBuilder(stateLabel(state));
        if(player!=null){
            long time=player.getTime();
            if(time>=0)text.append(" · 播放位置 ").append(time/1000).append(" 秒");
            IMedia media=player.getMedia();
            if(media!=null){
                try{
                    IMedia.Stats stats=media.getStats();
                    if(stats!=null)text.append("\n本次解码 ").append(stats.decodedVideo)
                        .append(" 帧 · 显示 ").append(stats.displayedPictures)
                        .append(" 帧 · 丢失 ").append(stats.lostPictures).append(" 帧");
                }finally{media.release();}
            }
        }
        text.append('\n');
        StreamMetrics.Snapshot stream=streamSnapshot();
        if(stream==null)return text.append("尚无取流统计。").toString();
        text.append(String.format(java.util.Locale.ROOT,
            "近 5 秒转发速度 %.2f Mb/s\n已读 %.2f MiB · 已转发 %.2f MiB\n上游请求 %d 次 · 续接／刷新 %d 次\n开播后缓冲 %d 次 · %.1f 秒\n",
            stream.recentMbps(),stream.received/1048576.0,stream.forwarded/1048576.0,
            stream.responses,stream.retries,bufferEpisodes(),rebufferMs()/1000.0));
        String[] labels={"获取地址","等待上游响应","读取视频数据","写给播放器"};
        for(StreamMetrics.Step step:StreamMetrics.Step.values()){
            text.append('\n').append(labels[step.ordinal()]).append(" · 最长 ").append(stream.maxMs(step)).append(" ms");
            if(stream.currentMs(step)>0)text.append(" · 当前 ").append(stream.currentMs(step)).append(" ms");
        }
        return text.toString();
    }
    private int restoreOutput(){
        if(player==null)return -1;IMedia media=player.getMedia();if(media==null)return -1;
        try{IMedia.Stats stats=media.getStats();if(stats==null)return -1;return player.getVideoTracksCount()>0||stats.decodedVideo>0?stats.displayedPictures:player.getAudioTracksCount()>0?stats.decodedAudio:-1;}finally{media.release();}
    }
    private void sample(){
        if(player==null||!loaded||state==State.ENDED||restoreFailed)return;long time=player.getTime(),length=player.getLength();if(length>0)duration=length;
        boolean reached=restoreAt<0;
        if(!reached&&pausedRestore!=null){
            PausedRestore.Outcome outcome=pausedRestore.observe(time,restoreOutput(),android.os.SystemClock.elapsedRealtime());
            if(outcome==PausedRestore.Outcome.RETRY){player.setTime(restoreAt);return;}
            if(outcome==PausedRestore.Outcome.FAILED){restoreFailed=true;wantPaused=true;player.pause();state(State.ERROR,"无法准确恢复暂停位置，原进度保留。请重新连接或按播放重试。");return;}
            reached=outcome==PausedRestore.Outcome.READY;
        }else if(!reached)reached=Math.abs(time-restoreAt)<5000;
        if(time>=0&&reached){position=time;restoreAt=-1;pausedRestore=null;}
    }
    private void save(){if(loaded&&state!=State.ENDED){sample();listener.progress(position,duration);}}
    private final Runnable timer=new Runnable(){@Override public void run(){if(player==null||disposed)return;sample();if(wantPaused&&loaded&&!restoreFailed&&restoreAt<0&&state!=State.PAUSED&&state!=State.ENDED&&state!=State.ERROR)pauseWhenRestored();publish();if(++ticks%5==0)save();main.postDelayed(this,1000);}};

    void start(VLCVideoLayout video,long resume,boolean paused){
        if(disposed)return;stop();this.video=video;position=Math.max(0,resume);restoreAt=-1;duration=0;wantPaused=paused;mutedForRestore=paused;loaded=false;restoreApplied=false;buffered=0;loginAttempts=0;ticks=0;subtitleChecked=false;
        playbackStarted=false;bufferBegan=0;bufferedAfterStart=0;bufferEpisodes=0;
        final int session=++generation;network=new NetworkScope();final NetworkScope attempt=network;state(State.CONNECTING,"");
        try{
            connecting=connector.submit(()->{
                PlaybackRelay pending=null;PlaybackRelay.Session pendingSession=null;CloudHlsRelay pendingHls=null;
                try{
                    MediaSources sources=new MediaSources(context).withScope(attempt);MediaSources.Lease direct=null;
                    if(!Json.text(file,"_cloudVariant").isEmpty()){pendingHls=new CloudHlsRelay(sources,file,Json.text(file,"_cloudVariant"));pendingHls.prepare(attempt);direct=pendingHls.endpoint();}
                    else if(Json.text(file,"source").equals("quark")){pendingSession=CinemaApplication.dav(context).openPlayback(file,attempt);direct=pendingSession.endpoint;}else pending=new PlaybackRelay(sources,file);
                    attempt.check();final PlaybackRelay ready=pending;final PlaybackRelay.Session readySession=pendingSession;final MediaSources.Lease endpoint=direct;final CloudHlsRelay readyHls=pendingHls;
                    main.post(()->{
                        if(session!=generation||disposed||attempt.cancelled()){if(ready!=null)ready.close();if(readySession!=null)readySession.close();if(readyHls!=null)readyHls.close();return;}relay=ready;davSession=readySession;hlsRelay=readyHls;
                        try{
                            // Only the winning, fully-resolved connection allocates a native decoder/Surface.
                            ArrayList<String> options=new ArrayList<>();options.add("--quiet");options.add("--no-video-title-show");options.add("--network-caching=1500");
                            vlc=new LibVLC(context,options);player=new MediaPlayer(vlc);final MediaPlayer engine=player;
                            engine.attachViews(video,null,false,false);engine.setEventListener(event->onEvent(session,engine,event));mutedForRestore=wantPaused;
                            Media media=new Media(vlc,Uri.parse(endpoint==null?ready.url():endpoint.url.toString()));
                            try{if(endpoint!=null)localLogin(endpoint,session,engine,media);seekAtOpen=wantPaused&&position>0;if(seekAtOpen)media.addOption(":start-time="+String.format(java.util.Locale.ROOT,"%.3f",position/1000.0));media.setHWDecoderEnabled(true,false);engine.setMedia(media);}finally{media.release();}
                            if(mutedForRestore)engine.setVolume(0);engine.play();main.postDelayed(timer,1000);
                        }catch(Exception|LinkageError failure){state(State.ERROR,"播放器启动失败，请重新连接或更换资源。");release();}
                    });pending=null;pendingSession=null;pendingHls=null;
                }catch(Exception failure){if(pending!=null)pending.close();if(pendingSession!=null)pendingSession.close();if(pendingHls!=null)pendingHls.close();main.post(()->{if(session==generation&&!disposed&&!attempt.cancelled())state(State.ERROR,"媒体源连接失败，请检查网络、登录状态及所选文件夹后重试。");});}
            });
        }catch(Exception|LinkageError failure){state(State.ERROR,"播放器初始化失败，该设备可能不兼容。");release();}
    }

    private void onEvent(int session,MediaPlayer engine,MediaPlayer.Event event){
        if(!current(session,engine)){return;}
        if(event.type==MediaPlayer.Event.Buffering){
            buffered=event.getBuffering();
            if(state==State.PAUSED||state==State.ENDED||state==State.ERROR){return;}
            if(buffered<100)state(State.BUFFERING,"");
            else if(loaded&&engine.isPlaying()){if(wantPaused){sample();pauseWhenRestored();}else state(State.PLAYING,"");}
        }
        else if(event.type==MediaPlayer.Event.Playing){
            if(restoreFailed){engine.pause();return;}loaded=true;loginAttempts=0;if(!restoreApplied){restoreApplied=true;engine.setRate(playbackRate);if(position>0){restoreAt=position;pausedRestore=wantPaused?new PausedRestore(position,restoreOutput()):null;if(!seekAtOpen)engine.setTime(position);}}
            if(wantPaused)pauseWhenRestored();else state(State.PLAYING,"");
            startSubtitles(engine);
            if(subtitleResumeOptions!=null){
                subtitleResumeOptions.restore(engine);
                subtitleResumeOptions=null;
            }
        }else if(event.type==MediaPlayer.Event.TimeChanged&&loaded&&restoreApplied){sample();if(wantPaused&&state!=State.PAUSED&&state!=State.ENDED)pauseWhenRestored();}
        else if(event.type==MediaPlayer.Event.Paused){if(mutedForRestore){mutedForRestore=false;engine.setVolume(100);}save();if(!restoreFailed)state(State.PAUSED,"");}
        else if(event.type==MediaPlayer.Event.EncounteredError){save();String error=hlsRelay!=null?hlsRelay.error():relay==null?CinemaApplication.dav(context).error(file):relay.error(file);state(State.ERROR,error.isEmpty()?"无法播放该资源，请检查连接或更换电视支持的编码版本。":error);}
        else if(event.type==MediaPlayer.Event.EndReached){if(restoreFailed)return;wantPaused=true;restoreAt=-1;position=0;duration=Math.max(duration,engine.getLength());state(State.ENDED,"播放完毕");listener.progress(0,duration);}
    }

    private void startSubtitles(MediaPlayer engine) {
        if (subtitleChecked) return;
        subtitleChecked = true;
        if (subtitlesOff) {
            engine.setSpuTrack(-1);
        } else if (preferExternal) {
            if (subtitleFile != null) attachSubtitle(engine, subtitleFile);
            else loadSubtitle(null, null);
        }
    }

    private NetworkScope beginSubtitleTask(boolean automatic) {
        cancelSubtitleTask();
        subtitleScope = new NetworkScope();
        if (automatic) subtitleScope.background();
        return subtitleScope;
    }

    private void cancelSubtitleTask() {
        if (subtitleScope != null) {
            subtitleScope.close();
            subtitleScope = null;
        }
        if (subtitleTask != null) {
            subtitleTask.cancel(true);
            subtitleTask = null;
        }
    }

    private boolean finishSubtitleTask(NetworkScope scope, MediaPlayer engine) {
        if (disposed || engine != player || subtitleScope != scope) return false;
        subtitleScope = null;
        subtitleTask = null;
        return true;
    }

    void listSubtitles(SubtitleList result, SubtitleMessage message) {
        MediaPlayer engine = player;
        if (engine == null || !loaded) {
            message.show("视频连接后可选择外挂字幕。");
            return;
        }
        NetworkScope scope = beginSubtitleTask(false);
        subtitleTask = connector.submit(() -> {
            try (NetworkScope owned = scope) {
                List<MediaSources.Entry> entries = SubtitleFiles.list(new MediaSources(context).withScope(scope), file);
                main.post(() -> {
                    if (finishSubtitleTask(scope, engine)) result.ready(entries);
                });
            } catch (Exception failure) {
                main.post(() -> {
                    if (finishSubtitleTask(scope, engine)) message.show("无法读取当前目录中的字幕。");
                });
            }
        });
    }

    void selectSubtitleTrack(int id) {
        cancelSubtitleTask();
        preferExternal = false;
        subtitlesOff = id == -1;
        if (player != null) player.setSpuTrack(id);
    }

    private boolean attachSubtitle(MediaPlayer engine, File subtitle) {
        try {
            return engine.addSlave(IMedia.Slave.Type.Subtitle, Uri.fromFile(subtitle), true);
        } catch (RuntimeException failure) {
            return false;
        }
    }

    void loadSubtitle(MediaSources.Entry chosen, SubtitleMessage message) {
        MediaPlayer engine = player;
        if (engine == null || !loaded) {
            if (message != null) message.show("视频连接后可加载外挂字幕。");
            return;
        }
        boolean automatic = chosen == null;
        if (!automatic && subtitleFile != null && subtitleId.equals(chosen.id)) {
            preferExternal = true;
            subtitlesOff = false;
            reconnectForSubtitle(engine);
            message.show("已选择外挂字幕。");
            return;
        }
        NetworkScope scope = beginSubtitleTask(automatic);
        subtitleTask = connector.submit(() -> {
            try (NetworkScope owned = scope) {
                MediaSources sources = new MediaSources(context).withScope(scope);
                MediaSources.Entry entry = automatic
                    ? SubtitleFiles.automatic(Json.text(file, "name"), SubtitleFiles.list(sources, file))
                    : chosen;
                if (entry == null) {
                    main.post(() -> finishSubtitleTask(scope, engine));
                    return;
                }
                File copy = SubtitleFiles.fetch(context, sources, entry, scope);
                main.post(() -> {
                    if (!finishSubtitleTask(scope, engine)) {
                        copy.delete();
                        return;
                    }
                    applySubtitle(engine, copy, entry.id, message);
                });
            } catch (Exception failure) {
                main.post(() -> {
                    if (finishSubtitleTask(scope, engine) && message != null) {
                        message.show("未能加载字幕，请检查文件格式、大小或连接后重试。");
                    }
                });
            }
        });
    }

    private void applySubtitle(MediaPlayer engine, File copy, String id, SubtitleMessage message) {
        File previous = subtitleFile;
        if (previous == null && !attachSubtitle(engine, copy)) {
            copy.delete();
            if (message != null) message.show("播放器未能打开该字幕。");
            return;
        }
        subtitleFile = copy;
        subtitleId = id;
        preferExternal = true;
        subtitlesOff = false;
        if (previous != null) {
            // Reopen at the same position to replace the previous slave without retaining tracks.
            reconnectForSubtitle(engine);
            previous.delete();
        }
        if (message != null) message.show("已选择外挂字幕。");
    }

    private void reconnectForSubtitle(MediaPlayer engine) {
        subtitleResumeOptions=new SubtitleResumeOptions(engine);
        reconnect();
    }

    void reconnect(){if(video==null||disposed)return;save();long resume=state==State.ENDED?0:position;boolean paused=state!=State.ENDED&&wantPaused;start(video,resume,paused);}
    private void pauseWhenRestored(){
        if(restoreFailed)return;
        if(!loaded||!restoreApplied||restoreAt>=0){state(State.BUFFERING,"正在恢复暂停位置…");return;}
        if(player!=null){player.pause();state(State.PAUSED,"");}
    }
    void toggle(){
        if(player==null){if(state==State.CONNECTING){wantPaused=!wantPaused;message=wantPaused?"连接后保持暂停":"";publish();}else reconnect();return;}wantPaused=!wantPaused;
        if(!loaded)return;
        if(restoreFailed){if(!wantPaused)reconnect();return;}
        if(wantPaused){pauseWhenRestored();save();}else{if(mutedForRestore){mutedForRestore=false;player.setVolume(100);}if(state==State.ENDED){position=0;restoreApplied=false;player.setTime(0);}player.play();if(player.isPlaying())state(State.PLAYING,"");}
    }
    void setPaused(boolean paused){if(state==State.ERROR||state==State.STOPPED){wantPaused=paused;if(!paused)reconnect();return;}if(wantPaused!=paused)toggle();}
    float playbackRate(){return playbackRate;}
    boolean setPlaybackRate(float rate){
        if(player==null||!loaded||Float.isNaN(rate)||Float.isInfinite(rate)||rate<0.5f||rate>2f)return false;
        float previous=playbackRate;player.setRate(rate);float actual=player.getRate();
        if(Float.isNaN(actual)||Float.isInfinite(actual)||Math.abs(actual-rate)>0.01f){player.setRate(previous);return false;}
        playbackRate=rate;return true;
    }
    boolean seek(long delta){
        if(player==null)return false;
        sample();
        return seekTo(position+delta);
    }
    boolean seekTo(long target){
        if(player==null||restoreFailed||!player.isSeekable())return false;
        target=Math.max(0,target);
        if(duration>0)target=Math.min(target,Math.max(0,duration-1000));
        player.setTime(target);
        return true;
    }
    private void localLogin(MediaSources.Lease endpoint,int session,MediaPlayer engine,Media media){
        if(!endpoint.url.host().equals("127.0.0.1")||!endpoint.url.scheme().equals("http"))throw new IllegalArgumentException("Local endpoint required");
        String decoded=new String(Base64.decode(endpoint.headers.get("Authorization").substring(6),Base64.NO_WRAP),StandardCharsets.UTF_8);int colon=decoded.indexOf(':');String username=decoded.substring(0,colon),password=decoded.substring(colon+1);
        if(hlsRelay!=null){media.addOption(":http-user="+username);media.addOption(":http-pwd="+password);}

        VlcDialogs.claim(vlc,new Dialog.Callbacks(){
            public void onDisplay(Dialog.LoginDialog dialog){if(current(session,engine)&&++loginAttempts<=2)dialog.postLogin(username,password,false);else dialog.dismiss();}
            public void onDisplay(Dialog.ErrorMessage dialog){}
            public void onDisplay(Dialog.QuestionDialog dialog){dialog.dismiss();}
            public void onDisplay(Dialog.ProgressDialog dialog){dialog.dismiss();}
            public void onCanceled(Dialog dialog){}
            public void onProgressUpdate(Dialog.ProgressDialog dialog){}
        });
    }
    // LibVLC's Java dialog callback is static. An old controller must not clear a newer owner.
    private static final class VlcDialogs {
        private static LibVLC owner;
        static synchronized void claim(LibVLC engine,Dialog.Callbacks callbacks){if(owner!=null&&owner!=engine)Dialog.setCallbacks(owner,null);owner=engine;Dialog.setCallbacks(engine,callbacks);}
        static synchronized void release(LibVLC engine){if(owner==engine){Dialog.setCallbacks(engine,null);owner=null;}}
    }
    private void release(){
        cancelSubtitleTask();
        generation++;main.removeCallbacks(timer);if(network!=null){network.close();network=null;}if(connecting!=null){connecting.cancel(true);connecting=null;}
        if(hlsRelay!=null){hlsRelay.close();hlsRelay=null;}if(davSession!=null){davSession.close();davSession=null;}if(relay!=null){relay.close();relay=null;}if(vlc!=null)VlcDialogs.release(vlc);
        if(player!=null){player.setEventListener(null);player.stop();player.detachViews();player.release();player=null;}
        if(vlc!=null){vlc.release();vlc=null;}loaded=false;pausedRestore=null;restoreFailed=false;seekAtOpen=false;
    }
    void stop(){save();release();state(State.STOPPED,"");}
    @Override public void close(){if(disposed)return;stop();disposed=true;connector.shutdownNow();if(subtitleFile!=null){subtitleFile.delete();subtitleFile=null;}}
}
