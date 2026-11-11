package io.mycinema.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.interfaces.IMedia;
import org.videolan.libvlc.util.VLCVideoLayout;
import java.util.Locale;

/** One embedded decoder, own remote-first controls; intents carry only stable catalog IDs. */
public final class PlayerActivity extends Activity {
    private MediaCatalog catalog;private JSONObject file;private PlaybackController controller;private VLCVideoLayout video;
    private TextView title,status,seekFeedback;private final android.os.Handler remote=new android.os.Handler(android.os.Looper.getMainLooper());private PlaybackController.State previousState;private boolean centerCaptured;private long lastSeekKey;
    private LinearLayout controls;private Button toggle;private long resume;
    private final Runnable hideControls=()->{if(controller!=null&&controller.snapshot().state==PlaybackController.State.PLAYING&&hasWindowFocus())controls.setVisibility(View.GONE);};
    @Override public void onCreate(Bundle state){
        super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN|WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        catalog=new MediaCatalog(this);file=catalog.get(getIntent().getStringExtra("mediaKey"));if(file==null){finish();return;}resume=catalog.position(Json.text(file,"key"));
        controller=new PlaybackController(this,file,new PlaybackController.Listener(){
            public void changed(PlaybackController.Snapshot snapshot){render(snapshot);}
            public void progress(long position,long duration){resume=position;catalog.progress(Json.text(file,"key"),position,duration);}
        });
        FrameLayout root=new FrameLayout(this);root.setBackgroundColor(0xff000000);video=new VLCVideoLayout(this);root.addView(video,new FrameLayout.LayoutParams(-1,-1));seekFeedback=new TextView(this);seekFeedback.setTextColor(MainActivity.PRIMARY);seekFeedback.setTextSize(24);seekFeedback.setGravity(Gravity.CENTER);seekFeedback.setVisibility(View.GONE);root.addView(seekFeedback,new FrameLayout.LayoutParams(-1,-2,Gravity.CENTER));
        controls=new LinearLayout(this);controls.setOrientation(LinearLayout.VERTICAL);controls.setPadding(24,12,24,18);controls.setBackgroundColor(0xdd101216);FrameLayout.LayoutParams params=new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM);root.addView(controls,params);
        title=new TextView(this);title.setTextColor(MainActivity.PRIMARY);title.setTextSize(18);title.setText(Json.text(file,"name"));controls.addView(title);status=new TextView(this);status.setTextColor(MainActivity.PRIMARY);status.setTextSize(14);controls.addView(status);
        LinearLayout actions=new LinearLayout(this);toggle=button("暂停 / 播放",this::toggle);actions.addView(toggle);actions.addView(button("后退10秒",()->seek(-10000)));actions.addView(button("前进10秒",()->seek(10000)));actions.addView(button("音轨 / 字幕",this::tracks));actions.addView(button("重新连接",this::retry));actions.addView(button("退出播放",this::finish));android.widget.HorizontalScrollView rail=new android.widget.HorizontalScrollView(this);rail.setHorizontalScrollBarEnabled(false);rail.addView(actions);controls.addView(rail);setContentView(root);toggle.requestFocus();
    }
    @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(focus){getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);scheduleHide();}}
    @Override protected void onStart(){super.onStart();if(controller!=null)controller.start(video,resume,false);}
    private void retry(){if(controller!=null)controller.reconnect();}
    private void render(PlaybackController.Snapshot state){
        if(status==null)return;
        if(previousState!=state.state){previousState=state.state;if(state.state==PlaybackController.State.PLAYING)scheduleHide();else{remote.removeCallbacks(hideControls);controls.setVisibility(View.VISIBLE);}}
        if(!state.message.isEmpty()){status.setText(state.message);return;}
        String prefix=state.state==PlaybackController.State.CONNECTING?"正在连接媒体源… · ":state.state==PlaybackController.State.BUFFERING?"正在缓冲 "+Math.round(state.buffered)+"% · ":state.state==PlaybackController.State.PAUSED?"已暂停 · ":"";
        status.setText(prefix+clock(state.position)+" / "+clock(state.duration)+"   ·   隐藏面板后：左右 ±10秒 · 确认 暂停/播放 · 菜单 音轨/字幕");
    }
    private Button button(String text,Runnable action){Button button=new Button(this);button.setText(text);button.setAllCaps(false);button.setTextSize(13);button.setTextColor(MainActivity.PRIMARY);RemoteUi.button(button);button.setOnClickListener(view->action.run());return button;}
    private void toggle(){if(controller!=null)controller.toggle();}
    private void seek(long delta){if(controller==null||!controller.seek(delta)){status.setText("当前媒体源尚不支持定位，或仍在缓冲。");return;}if(controls.getVisibility()!=View.VISIBLE){seekFeedback.setText((delta<0?"后退 ":"前进 ")+Math.abs(delta)/1000+" 秒");seekFeedback.setVisibility(View.VISIBLE);remote.removeCallbacks(clearSeek);remote.postDelayed(clearSeek,1300);}scheduleHide();}
    private static String clock(long value){long seconds=Math.max(0,value)/1000;return String.format(Locale.ROOT,"%d:%02d:%02d",seconds/3600,(seconds/60)%60,seconds%60);}
    private void tracks(){if(controller==null||controller.engine()==null)return;new AlertDialog.Builder(this).setTitle("播放选项").setItems(new String[]{"选择音轨","选择字幕","调整音频同步","调整字幕同步","播放速度","播放信息"},(dialog,index)->{if(index<2)selectTracks(index==0);else if(index<4)adjustDelay(index==2);else if(index==4)selectSpeed();else playbackInfo();}).setNegativeButton("返回",null).show();}
    private void selectSpeed(){
        if(controller==null||controller.engine()==null)return;
        final float[] rates={0.5f,0.75f,1f,1.25f,1.5f,2f};
        final String[] labels={"0.5×","0.75×","正常 · 1×","1.25×","1.5×","2×"};
        int selected=2;for(int i=0;i<rates.length;i++)if(Math.abs(controller.playbackRate()-rates[i])<0.01f)selected=i;
        final PlaybackController current=controller;final MediaPlayer engine=current.engine();
        new AlertDialog.Builder(this).setTitle("播放速度").setSingleChoiceItems(labels,selected,(dialog,index)->{
            if(controller==current&&current.engine()==engine){if(!current.setPlaybackRate(rates[index]))status.setText("当前媒体暂不支持该播放速度。");}
            dialog.dismiss();
        }).setNegativeButton("返回",null).show();
    }
    private void playbackInfo(){
        MediaPlayer player=controller==null?null:controller.engine();if(player==null)return;
        String info=playbackInfoText(player);
        new AlertDialog.Builder(this).setTitle("播放信息").setMessage(info).setPositiveButton("完成",null).show();
    }
    static String playbackInfoText(MediaPlayer player){
        IMedia media=player.getMedia();if(media==null)return "媒体信息暂不可用。";
        StringBuilder info=new StringBuilder();
        try{
            for(int i=0;i<media.getTrackCount();i++){
                IMedia.Track track=media.getTrack(i);if(track==null)continue;
                if(track instanceof IMedia.VideoTrack){IMedia.VideoTrack video=(IMedia.VideoTrack)track;
                    info.append("视频：").append(track.codec==null?"未知":track.codec);
                    if(video.width>0&&video.height>0)info.append(" · ").append(video.width).append(" × ").append(video.height);
                    if(video.frameRateNum>0&&video.frameRateDen>0)info.append(String.format(Locale.ROOT," · %.2f 帧/秒",(double)video.frameRateNum/video.frameRateDen));
                    if(track.bitrate>0)info.append(String.format(Locale.ROOT," · %.1f Mb/s",track.bitrate/1000000.0));
                    info.append('\n');
                }else if(track instanceof IMedia.AudioTrack){IMedia.AudioTrack audio=(IMedia.AudioTrack)track;
                    info.append("音频：").append(track.codec==null?"未知":track.codec);
                    if(audio.channels>0)info.append(" · ").append(audio.channels).append(" 声道");
                    if(audio.rate>0)info.append(" · ").append(audio.rate).append(" Hz");
                    if(track.language!=null&&!track.language.isEmpty())info.append(" · ").append(track.language);
                    info.append('\n');
                }
            }
            IMedia.Stats stats=media.getStats();if(stats!=null)info.append("本次会话已显示帧：").append(stats.displayedPictures).append(" · 丢失帧：").append(stats.lostPictures).append('\n');
        }finally{media.release();}
        if(info.length()==0)info.append("轨道信息尚未就绪。\n");
        info.append("实际硬解 / 软解：当前无法确认。\n码率为媒体报告值，可能不可用；音频列表包含所有轨道。");
        return info.toString();
    }
    private void adjustDelay(boolean audio){
        MediaPlayer player=controller==null?null:controller.engine();if(player==null)return;
        long delay=audio?player.getAudioDelay():player.getSpuDelay();
        String label=audio?"音频":"字幕";
        new AlertDialog.Builder(this).setTitle(String.format(Locale.ROOT,"%s同步：%+.1f 秒（正值为延后）",label,delay/1000000.0))
            .setItems(new String[]{"提前 0.5 秒","延后 0.5 秒","恢复默认"},(dialog,index)->{
                MediaPlayer current=controller==null?null:controller.engine();if(current!=player)return;
                long next=index==2?0:Math.max(-60000000L,Math.min(60000000L,delay+(index==0?-500000L:500000L)));
                boolean ok=audio?player.setAudioDelay(next):player.setSpuDelay(next);
                if(ok)adjustDelay(audio);else status.setText("无法调整"+label+"同步，请确认媒体正在播放。");
            }).setNegativeButton("完成",null).show();
    }
    private void selectTracks(boolean audio){MediaPlayer player=controller==null?null:controller.engine();if(player==null)return;MediaPlayer.TrackDescription[] tracks=audio?player.getAudioTracks():player.getSpuTracks();if(tracks==null||tracks.length==0){status.setText(audio?"此资源没有可选音轨。":"此资源没有内嵌字幕；外挂字幕将在后续支持。");return;}String[] labels=new String[tracks.length];for(int i=0;i<tracks.length;i++)labels[i]=tracks[i].id==-1?(audio?"关闭音轨":"关闭字幕"):tracks[i].name;new AlertDialog.Builder(this).setTitle(audio?"音轨":"字幕").setItems(labels,(dialog,n)->{MediaPlayer current=controller==null?null:controller.engine();if(current!=null&&current==player){if(audio)current.setAudioTrack(tracks[n].id);else current.setSpuTrack(tracks[n].id);}}).setNegativeButton("返回",null).show();}
    private final Runnable clearSeek=()->{if(seekFeedback!=null)seekFeedback.setVisibility(View.GONE);};
    private void scheduleHide(){remote.removeCallbacks(hideControls);if(controls!=null&&controller!=null&&controller.snapshot().state==PlaybackController.State.PLAYING)remote.postDelayed(hideControls,5000);}
    @Override public void onUserInteraction(){super.onUserInteraction();scheduleHide();}
    private void showControls(){controls.setVisibility(View.VISIBLE);toggle.requestFocus();scheduleHide();}
    @Override public boolean dispatchKeyEvent(KeyEvent event){int code=event.getKeyCode();if((code==KeyEvent.KEYCODE_DPAD_CENTER||code==KeyEvent.KEYCODE_ENTER)&&(centerCaptured||controls!=null&&controls.getVisibility()!=View.VISIBLE)){if(event.getAction()==KeyEvent.ACTION_DOWN){if(event.getRepeatCount()==0){centerCaptured=true;toggle();showControls();}}else if(event.getAction()==KeyEvent.ACTION_UP)centerCaptured=false;return true;}return super.dispatchKeyEvent(event);}
    @Override public boolean onKeyDown(int code,KeyEvent event){
        if(code==KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE||code==KeyEvent.KEYCODE_MEDIA_PLAY||code==KeyEvent.KEYCODE_MEDIA_PAUSE){if(event.getRepeatCount()==0&&controller!=null){PlaybackController.State state=controller.snapshot().state;if(code==KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE||code==KeyEvent.KEYCODE_MEDIA_PLAY&&state!=PlaybackController.State.PLAYING||code==KeyEvent.KEYCODE_MEDIA_PAUSE&&state==PlaybackController.State.PLAYING)toggle();}return true;}
        if(code==KeyEvent.KEYCODE_MENU){if(event.getRepeatCount()==0)tracks();return true;}
        if(code==KeyEvent.KEYCODE_MEDIA_REWIND||code==KeyEvent.KEYCODE_MEDIA_FAST_FORWARD||controls.getVisibility()!=View.VISIBLE&&(code==KeyEvent.KEYCODE_DPAD_LEFT||code==KeyEvent.KEYCODE_DPAD_RIGHT)){long now=android.os.SystemClock.uptimeMillis();if(event.getRepeatCount()==0||now-lastSeekKey>=200){lastSeekKey=now;seek((code==KeyEvent.KEYCODE_DPAD_LEFT||code==KeyEvent.KEYCODE_MEDIA_REWIND?-1:1)*(event.getRepeatCount()>8?30000:10000));}return true;}
        if(controls.getVisibility()!=View.VISIBLE&&(code==KeyEvent.KEYCODE_DPAD_UP||code==KeyEvent.KEYCODE_DPAD_DOWN)){showControls();return true;}return super.onKeyDown(code,event);
    }
    @Override public void onBackPressed(){if(controls.getVisibility()==View.VISIBLE){remote.removeCallbacks(hideControls);controls.setVisibility(View.GONE);}else{showControls();AlertDialog prompt=new AlertDialog.Builder(this).setTitle("退出播放？").setMessage("进度会保存在电视本机。").setNegativeButton("继续播放",null).setPositiveButton("退出",(dialog,n)->finish()).create();prompt.setOnShowListener(d->prompt.getButton(AlertDialog.BUTTON_NEGATIVE).requestFocus());prompt.show();}}
    @Override protected void onStop(){remote.removeCallbacksAndMessages(null);if(controller!=null)controller.stop();super.onStop();}
    @Override protected void onDestroy(){remote.removeCallbacksAndMessages(null);if(controller!=null)controller.close();if(catalog!=null)catalog.close();super.onDestroy();}
}
