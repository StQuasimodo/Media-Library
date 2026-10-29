package io.mycinema.tv;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import java.io.Closeable;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.json.JSONObject;
import org.videolan.libvlc.Dialog;
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

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
    private final Context context;private final JSONObject file;private final Listener listener;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService connector=Executors.newSingleThreadExecutor();
    private Future<?> connecting;private NetworkScope network;private PlaybackRelay relay;
    private PlaybackRelay.Session davSession;
    private LibVLC vlc;private volatile MediaPlayer player;private VLCVideoLayout video;
    private int generation,ticks,loginAttempts;private long position,duration,restoreAt=-1;
    private boolean loaded,restoreApplied,wantPaused,mutedForRestore,disposed;private float buffered;
    private State state=State.STOPPED;private String message="";
    private volatile Snapshot snapshot=new Snapshot(State.STOPPED,0,0,0,"");

    PlaybackController(Context context,JSONObject file,Listener listener){this.context=context.getApplicationContext();this.file=Json.copy(file);this.listener=listener;}
    Snapshot snapshot(){return snapshot;}
    MediaPlayer engine(){return player;}
    private boolean current(int session,MediaPlayer engine){return session==generation&&engine==player&&!disposed;}
    private void publish(){snapshot=new Snapshot(state,position,duration,buffered,message);listener.changed(snapshot);}
    private void state(State state,String message){this.state=state;this.message=message;publish();}
    private void sample(){if(player==null||!loaded||state==State.ENDED)return;long time=player.getTime(),length=player.getLength();if(time>=0&&(restoreAt<0||Math.abs(time-restoreAt)<5000)){position=time;restoreAt=-1;}if(length>0)duration=length;}
    private void save(){if(loaded&&state!=State.ENDED){sample();listener.progress(position,duration);}}
    private final Runnable timer=new Runnable(){@Override public void run(){if(player==null||disposed)return;sample();publish();if(++ticks%5==0)save();main.postDelayed(this,1000);}};

    void start(VLCVideoLayout video,long resume,boolean paused){
        if(disposed)return;stop();this.video=video;position=Math.max(0,resume);restoreAt=-1;duration=0;wantPaused=paused;mutedForRestore=paused;loaded=false;restoreApplied=false;buffered=0;loginAttempts=0;ticks=0;
        final int session=++generation;network=new NetworkScope();final NetworkScope attempt=network;state(State.CONNECTING,"");
        try{
            connecting=connector.submit(()->{
                PlaybackRelay pending=null;PlaybackRelay.Session pendingSession=null;
                try{
                    MediaSources sources=new MediaSources(context).withScope(attempt);MediaSources.Lease direct=null;
                    if(Json.text(file,"source").equals("quark")){pendingSession=CinemaApplication.dav(context).openPlayback(file,attempt);direct=pendingSession.endpoint;}else pending=new PlaybackRelay(sources,file);
                    attempt.check();final PlaybackRelay ready=pending;final PlaybackRelay.Session readySession=pendingSession;final MediaSources.Lease endpoint=direct;
                    main.post(()->{
                        if(session!=generation||disposed||attempt.cancelled()){if(ready!=null)ready.close();if(readySession!=null)readySession.close();return;}relay=ready;davSession=readySession;
                        try{
                            // Only the winning, fully-resolved connection allocates a native decoder/Surface.
                            ArrayList<String> options=new ArrayList<>();options.add("--quiet");options.add("--no-video-title-show");options.add("--network-caching=1500");
                            vlc=new LibVLC(context,options);player=new MediaPlayer(vlc);final MediaPlayer engine=player;
                            engine.attachViews(video,null,false,false);engine.setEventListener(event->onEvent(session,engine,event));mutedForRestore=wantPaused;
                            Media media=new Media(vlc,Uri.parse(endpoint==null?ready.url():endpoint.url.toString()));
                            try{if(endpoint!=null)localLogin(endpoint,session,engine);media.setHWDecoderEnabled(true,false);engine.setMedia(media);}finally{media.release();}
                            if(mutedForRestore)engine.setVolume(0);engine.play();main.postDelayed(timer,1000);
                        }catch(Exception|LinkageError failure){state(State.ERROR,"播放器启动失败，请重新连接或更换资源。");release();}
                    });pending=null;pendingSession=null;
                }catch(Exception failure){if(pending!=null)pending.close();if(pendingSession!=null)pendingSession.close();main.post(()->{if(session==generation&&!disposed&&!attempt.cancelled())state(State.ERROR,"媒体源连接失败，请检查网络、登录状态及所选文件夹后重试。");});}
            });
        }catch(Exception|LinkageError failure){state(State.ERROR,"播放器初始化失败，该设备可能不兼容。");release();}
    }

    private void onEvent(int session,MediaPlayer engine,MediaPlayer.Event event){
        if(!current(session,engine)){return;}
        if(event.type==MediaPlayer.Event.Buffering){buffered=event.getBuffering();if(buffered<100&&state!=State.PAUSED)state(State.BUFFERING,"");}
        else if(event.type==MediaPlayer.Event.Playing){
            loaded=true;loginAttempts=0;if(!restoreApplied){restoreApplied=true;if(position>0){restoreAt=position;engine.setTime(position);}}
            if(wantPaused)pauseWhenRestored();else state(State.PLAYING,"");
        }else if(event.type==MediaPlayer.Event.TimeChanged&&loaded&&restoreApplied){sample();if(wantPaused&&state!=State.PAUSED&&state!=State.ENDED)pauseWhenRestored();}
        else if(event.type==MediaPlayer.Event.Paused){if(mutedForRestore){mutedForRestore=false;engine.setVolume(100);}save();state(State.PAUSED,"");}
        else if(event.type==MediaPlayer.Event.EncounteredError){save();String error=relay==null?CinemaApplication.dav(context).error(file):relay.error(file);state(State.ERROR,error.isEmpty()?"无法播放该资源，请检查连接或更换电视支持的编码版本。":error);}
        else if(event.type==MediaPlayer.Event.EndReached){wantPaused=true;restoreAt=-1;position=0;duration=Math.max(duration,engine.getLength());state(State.ENDED,"播放完毕");listener.progress(0,duration);}
    }

    void reconnect(){if(video==null||disposed)return;save();long resume=state==State.ENDED?0:position;boolean paused=state!=State.ENDED&&wantPaused;start(video,resume,paused);}
    private void pauseWhenRestored(){
        if(!loaded||!restoreApplied||restoreAt>=0){state(State.BUFFERING,"正在恢复暂停位置…");return;}
        if(player!=null){player.pause();state(State.PAUSED,"");}
    }
    void toggle(){
        if(player==null){if(state==State.CONNECTING){wantPaused=!wantPaused;message=wantPaused?"连接后保持暂停":"";publish();}else reconnect();return;}wantPaused=!wantPaused;
        if(!loaded)return;
        if(wantPaused){pauseWhenRestored();save();}else{if(mutedForRestore){mutedForRestore=false;player.setVolume(100);}if(state==State.ENDED){position=0;restoreApplied=false;player.setTime(0);}player.play();if(player.isPlaying())state(State.PLAYING,"");}
    }
    boolean seek(long delta){
        if(player==null||!player.isSeekable())return false;sample();long target=Math.max(0,position+delta);if(duration>0)target=Math.min(target,Math.max(0,duration-1000));player.setTime(target);return true;
    }
    private void localLogin(MediaSources.Lease endpoint,int session,MediaPlayer engine){
        if(!endpoint.url.host().equals("127.0.0.1")||!endpoint.url.scheme().equals("http"))throw new IllegalArgumentException("Local endpoint required");
        String decoded=new String(Base64.decode(endpoint.headers.get("Authorization").substring(6),Base64.NO_WRAP),StandardCharsets.UTF_8);int colon=decoded.indexOf(':');String username=decoded.substring(0,colon),password=decoded.substring(colon+1);
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
        generation++;main.removeCallbacks(timer);if(network!=null){network.close();network=null;}if(connecting!=null){connecting.cancel(true);connecting=null;}
        if(davSession!=null){davSession.close();davSession=null;}if(relay!=null){relay.close();relay=null;}if(vlc!=null)VlcDialogs.release(vlc);
        if(player!=null){player.setEventListener(null);player.stop();player.detachViews();player.release();player=null;}
        if(vlc!=null){vlc.release();vlc=null;}loaded=false;
    }
    void stop(){save();release();state(State.STOPPED,"");}
    @Override public void close(){if(disposed)return;stop();disposed=true;connector.shutdownNow();}
}
