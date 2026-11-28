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
    private TextView title,status,seekFeedback,playbackTime;private android.widget.SeekBar timeline;private boolean draggingTimeline;private final android.os.Handler remote=new android.os.Handler(android.os.Looper.getMainLooper());private PlaybackController.State previousState;private boolean centerCaptured;private long lastSeekKey;
    private LinearLayout controls;private Button toggle;private long resume;private String cloudVariant="";private CloudPlaybackProgress cloudProgress;private boolean cloudSaveFailed;
    private final Runnable hideControls=()->{if(controller!=null&&!draggingTimeline&&controller.snapshot().state==PlaybackController.State.PLAYING&&hasWindowFocus())controls.setVisibility(View.GONE);};
    @Override public void onCreate(Bundle state){
        super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN|WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        catalog=new MediaCatalog(this);file=catalog.get(getIntent().getStringExtra("mediaKey"));if(file==null){finish();return;}cloudVariant=getIntent().getStringExtra("cloudVariant");if(cloudVariant==null)cloudVariant="";if(cloudVariant.length()>256||cloudVariant.contains("://")){finish();return;}
        if(!cloudVariant.isEmpty()){
            try{cloudProgress=new CloudPlaybackProgress(this);}catch(Exception failure){android.widget.Toast.makeText(this,"云端播放进度暂不可用，原数据已保留。",android.widget.Toast.LENGTH_LONG).show();finish();return;}Json.put(file,"_cloudVariant",cloudVariant);
        }
        resume=cloudVariant.isEmpty()?catalog.position(Json.text(file,"key")):cloudProgress.position(Json.text(file,"key"),cloudVariant);
        controller=new PlaybackController(this,file,new PlaybackController.Listener(){
            public void changed(PlaybackController.Snapshot snapshot){render(snapshot);}
            public void progress(long position,long duration){resume=position;if(cloudVariant.isEmpty())catalog.progress(Json.text(file,"key"),position,duration);else try{cloudProgress.save(Json.text(file,"key"),cloudVariant,position,duration);cloudSaveFailed=false;}catch(Exception failure){if(!cloudSaveFailed)android.widget.Toast.makeText(PlayerActivity.this,"云端进度未能保存，请检查存储空间。",android.widget.Toast.LENGTH_LONG).show();cloudSaveFailed=true;}}
        });
        FrameLayout root=new FrameLayout(this);root.setBackgroundColor(0xff000000);video=new VLCVideoLayout(this);root.addView(video,new FrameLayout.LayoutParams(-1,-1));seekFeedback=new TextView(this);seekFeedback.setTextColor(MainActivity.PRIMARY);seekFeedback.setTextSize(24);seekFeedback.setGravity(Gravity.CENTER);seekFeedback.setVisibility(View.GONE);root.addView(seekFeedback,new FrameLayout.LayoutParams(-1,-2,Gravity.CENTER));
        controls=new LinearLayout(this);controls.setOrientation(LinearLayout.VERTICAL);controls.setPadding(dp(24),dp(12),dp(24),dp(18));controls.setBackgroundColor(0xdd101216);FrameLayout.LayoutParams params=new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM);root.addView(controls,params);
        title=new TextView(this);title.setTextColor(MainActivity.PRIMARY);title.setTextSize(20);title.setMaxLines(1);title.setEllipsize(android.text.TextUtils.TruncateAt.END);title.setText(Json.text(file,"name")+(cloudVariant.isEmpty()?"":" · 云端HLS试播"));controls.addView(title);
        playbackTime=new TextView(this);playbackTime.setTextColor(MainActivity.PRIMARY);playbackTime.setTextSize(16);controls.addView(playbackTime);
        timeline=new android.widget.SeekBar(this);timeline.setId(R.id.player_timeline);timeline.setMax(1000);timeline.setFocusable(true);android.graphics.drawable.StateListDrawable focusTrack=new android.graphics.drawable.StateListDrawable();android.graphics.drawable.GradientDrawable trackRing=new android.graphics.drawable.GradientDrawable();trackRing.setColor(android.graphics.Color.TRANSPARENT);trackRing.setStroke(dp(2),MainActivity.ACCENT);trackRing.setCornerRadius(dp(6));focusTrack.addState(new int[]{android.R.attr.state_focused},trackRing);focusTrack.addState(new int[]{},new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT));timeline.setBackground(focusTrack);timeline.setKeyProgressIncrement(1);timeline.setContentDescription("播放时间轴，左右键后退或前进10秒，确认键暂停或播放");timeline.setProgressTintList(android.content.res.ColorStateList.valueOf(MainActivity.ACCENT));timeline.setThumbTintList(android.content.res.ColorStateList.valueOf(MainActivity.ACCENT));controls.addView(timeline,new LinearLayout.LayoutParams(-1,dp(32)));
        timeline.setOnSeekBarChangeListener(new android.widget.SeekBar.OnSeekBarChangeListener(){
            public void onStartTrackingTouch(android.widget.SeekBar bar){draggingTimeline=true;remote.removeCallbacks(hideControls);}
            public void onProgressChanged(android.widget.SeekBar bar,int value,boolean fromUser){if(fromUser&&controller!=null){PlaybackController.Snapshot state=controller.snapshot();playbackTime.setText(clock(state.duration*value/1000)+" / "+clock(state.duration));}}
            public void onStopTrackingTouch(android.widget.SeekBar bar){draggingTimeline=false;if(controller!=null){PlaybackController.Snapshot state=controller.snapshot();if(!controller.seekTo(state.duration*bar.getProgress()/1000))status.setText("当前媒体源尚不支持定位，或仍在缓冲。");}scheduleHide();}
        });
        timeline.setOnKeyListener((view,code,event)->{
            if(code==KeyEvent.KEYCODE_DPAD_LEFT||code==KeyEvent.KEYCODE_DPAD_RIGHT){if(event.getAction()==KeyEvent.ACTION_DOWN){long now=android.os.SystemClock.uptimeMillis();if(event.getRepeatCount()==0||now-lastSeekKey>=200){lastSeekKey=now;seek((code==KeyEvent.KEYCODE_DPAD_LEFT?-1:1)*(event.getRepeatCount()>8?30000:10000));}}return true;}
            if(code==KeyEvent.KEYCODE_DPAD_CENTER||code==KeyEvent.KEYCODE_ENTER){if(event.getAction()==KeyEvent.ACTION_DOWN&&event.getRepeatCount()==0){toggle();scheduleHide();}return true;}return false;
        });
        status=new TextView(this);status.setTextColor(MainActivity.PRIMARY);status.setTextSize(14);controls.addView(status);
        LinearLayout actions=new LinearLayout(this);toggle=button("暂停 / 播放",this::toggle);toggle.setId(R.id.player_toggle);toggle.setNextFocusUpId(R.id.player_timeline);timeline.setNextFocusDownId(R.id.player_toggle);actions.addView(toggle);actions.addView(button("后退10秒",()->seek(-10000)));actions.addView(button("前进10秒",()->seek(10000)));actions.addView(button("音轨 / 字幕",this::tracks));actions.addView(button("重新连接",this::retry));actions.addView(button("退出播放",this::finish));android.widget.HorizontalScrollView rail=new android.widget.HorizontalScrollView(this);rail.setHorizontalScrollBarEnabled(false);rail.addView(actions);controls.addView(rail);setContentView(root);toggle.requestFocus();
    }
    @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(focus){getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);scheduleHide();}}
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==42 && result==RESULT_OK && data!=null)resume=data.getLongExtra("position",resume);
    }
    @Override protected void onRestart(){
        super.onRestart();
        if(catalog!=null&&file!=null){
            String key=Json.text(file,"key");
            resume=cloudProgress==null?catalog.position(key):cloudProgress.position(key,cloudVariant);
        }
    }
    @Override protected void onStart(){super.onStart();if(controller!=null)controller.start(video,resume,false);}
    private void retry(){if(controller!=null)controller.reconnect();}
    private void render(PlaybackController.Snapshot state){
        if(status==null)return;
        if(previousState!=state.state){previousState=state.state;if(state.state==PlaybackController.State.PLAYING)scheduleHide();else{remote.removeCallbacks(hideControls);controls.setVisibility(View.VISIBLE);}}
        if(timeline!=null&&!draggingTimeline){timeline.setProgress(state.duration>0?(int)Math.max(0,Math.min(1000,state.position*1000/state.duration)):0);timeline.setEnabled(state.duration>0&&controller!=null&&controller.engine()!=null&&controller.engine().isSeekable());playbackTime.setText(clock(state.position)+" / "+(state.duration>0?clock(state.duration):"时长未知"));}
        if(!state.message.isEmpty()){status.setText(state.message);return;}
        String prefix=state.state==PlaybackController.State.CONNECTING?"正在连接媒体源… · ":state.state==PlaybackController.State.BUFFERING?"正在缓冲 "+Math.round(state.buffered)+"% · ":state.state==PlaybackController.State.PAUSED?"已暂停 · ":"";
        status.setText(prefix+"左右键定位   确认键暂停/播放   菜单键选择音轨与字幕");
    }
    private int dp(int value){return RemoteUi.dp(this,value);}
    private Button button(String text,Runnable action){Button button=new Button(this);button.setText(text);button.setAllCaps(false);button.setTextSize(16);button.setTextColor(MainActivity.PRIMARY);RemoteUi.button(button);button.setOnClickListener(view->action.run());return button;}
    private void toggle(){if(controller!=null)controller.toggle();}
    private void seek(long delta){if(controller==null||!controller.seek(delta)){status.setText("当前媒体源尚不支持定位，或仍在缓冲。");return;}if(controls.getVisibility()!=View.VISIBLE){seekFeedback.setText((delta<0?"后退 ":"前进 ")+Math.abs(delta)/1000+" 秒");seekFeedback.setVisibility(View.VISIBLE);remote.removeCallbacks(clearSeek);remote.postDelayed(clearSeek,1300);}scheduleHide();}
    private static String clock(long value){long seconds=Math.max(0,value)/1000;return String.format(Locale.ROOT,"%d:%02d:%02d",seconds/3600,(seconds/60)%60,seconds%60);}
    private void tracks(){
        if(controller==null)return;
        if(controller.engine()==null){showStreamDiagnostics();return;}
        RemoteUi.showList(new AlertDialog.Builder(this).setTitle("播放选项")
            .setItems(new String[]{"选择音轨","选择字幕轨道","选择外挂字幕","调整音频同步","调整字幕同步","播放速度","播放信息","取流诊断","双字幕播放"},
                (dialog,index)->{
                    if(index<2)selectTracks(index==0);
                    else if(index==2)chooseExternalSubtitle();
                    else if(index<5)adjustDelay(index==3);
                    else if(index==5)selectSpeed();
                    else if(index==6)playbackInfo();
                    else if(index==7)showStreamDiagnostics();
                    else startActivityForResult(new Intent(this,DualSubtitleActivity.class)
                        .putExtra("mediaKey",Json.text(file,"key")).putExtra("cloudVariant",cloudVariant)
                        .putExtra("position",controller.snapshot().position),42);
                })
            .setNegativeButton("返回",null),0);
    }
    private void subtitleNotice(String message){
        if(!isFinishing())android.widget.Toast.makeText(this,message,android.widget.Toast.LENGTH_SHORT).show();
    }
    private void chooseExternalSubtitle(){
        subtitleNotice("正在读取同目录字幕…");
        controller.listSubtitles(entries->{
            if(isFinishing())return;
            if(entries.isEmpty()){
                subtitleNotice("同目录未找到 SRT、ASS 或 SSA 字幕。");
                return;
            }
            String[] labels=new String[entries.size()];
            for(int i=0;i<labels.length;i++)labels[i]=entries.get(i).name;
            RemoteUi.showList(new AlertDialog.Builder(this).setTitle("选择同目录字幕")
                .setItems(labels,(dialog,index)->{
                    subtitleNotice("正在加载字幕…");
                    controller.loadSubtitle(entries.get(index),this::subtitleNotice);
                }).setNegativeButton("返回",null),0);
        },this::subtitleNotice);
    }
    private void selectSpeed(){
        if(controller==null||controller.engine()==null)return;
        final float[] rates={0.5f,0.75f,1f,1.25f,1.5f,2f};
        final String[] labels={"0.5×","0.75×","正常 · 1×","1.25×","1.5×","2×"};
        int selected=2;for(int i=0;i<rates.length;i++)if(Math.abs(controller.playbackRate()-rates[i])<0.01f)selected=i;
        final PlaybackController current=controller;final MediaPlayer engine=current.engine();
        RemoteUi.showList(new AlertDialog.Builder(this).setTitle("播放速度").setSingleChoiceItems(labels,selected,(dialog,index)->{
            if(controller==current&&current.engine()==engine){if(!current.setPlaybackRate(rates[index]))status.setText("当前媒体暂不支持该播放速度。");}
            dialog.dismiss();
        }).setNegativeButton("返回",null),selected);
    }
    private void playbackInfo(){
        MediaPlayer player=controller==null?null:controller.engine();if(player==null)return;
        String info=playbackInfoText(player);
        new AlertDialog.Builder(this).setTitle("播放信息").setMessage(info).setPositiveButton("完成",null).show();
    }
    private void showStreamDiagnostics(){
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("取流诊断")
            .setMessage(controller.streamDiagnostics())
            .setNeutralButton("复制",(d,n)->{
                android.content.ClipboardManager clipboard=(android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
                clipboard.setPrimaryClip(android.content.ClipData.newPlainText("取流诊断",controller.streamDiagnostics()));
                subtitleNotice("已复制诊断。");
            }).setPositiveButton("完成",null).create();
        Runnable update=new Runnable(){
            @Override public void run(){
                if(!dialog.isShowing()||isFinishing())return;
                dialog.setMessage(controller.streamDiagnostics());
                remote.postDelayed(this,1000);
            }
        };
        dialog.setOnDismissListener(ignored->remote.removeCallbacks(update));
        dialog.setOnShowListener(ignored->dialog.getButton(AlertDialog.BUTTON_NEUTRAL).requestFocus());
        dialog.show();
        remote.postDelayed(update,1000);
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
        RemoteUi.showList(new AlertDialog.Builder(this).setTitle(String.format(Locale.ROOT,"%s同步：%+.1f 秒（正值为延后）",label,delay/1000000.0))
            .setItems(new String[]{"提前 0.5 秒","延后 0.5 秒","恢复默认"},(dialog,index)->{
                MediaPlayer current=controller==null?null:controller.engine();if(current!=player)return;
                long next=index==2?0:Math.max(-60000000L,Math.min(60000000L,delay+(index==0?-500000L:500000L)));
                boolean ok=audio?player.setAudioDelay(next):player.setSpuDelay(next);
                if(ok)adjustDelay(audio);else status.setText("无法调整"+label+"同步，请确认媒体正在播放。");
            }).setNegativeButton("完成",null),0);
    }
    private void selectTracks(boolean audio){
        MediaPlayer player=controller==null?null:controller.engine();
        if(player==null)return;
        MediaPlayer.TrackDescription[] tracks=audio?player.getAudioTracks():player.getSpuTracks();
        if(tracks==null||tracks.length==0){
            subtitleNotice(audio?"此资源没有可选音轨。":"暂无字幕轨道，可从同目录选择外挂字幕。");
            return;
        }
        String[] labels=new String[tracks.length];
        int selected=0,active=audio?player.getAudioTrack():player.getSpuTrack();
        for(int i=0;i<tracks.length;i++){
            labels[i]=tracks[i].id==-1?(audio?"关闭音轨":"关闭字幕"):tracks[i].name;
            if(tracks[i].id==active)selected=i;
        }
        RemoteUi.showList(new AlertDialog.Builder(this).setTitle(audio?"音轨":"字幕")
            .setItems(labels,(dialog,n)->{
                if(controller.engine()==player){
                    if(audio)player.setAudioTrack(tracks[n].id);
                    else controller.selectSubtitleTrack(tracks[n].id);
                }
            }).setNegativeButton("返回",null),selected);
    }
    private final Runnable clearSeek=()->{if(seekFeedback!=null)seekFeedback.setVisibility(View.GONE);};
    private void scheduleHide(){remote.removeCallbacks(hideControls);if(controls!=null&&controller!=null&&controller.snapshot().state==PlaybackController.State.PLAYING)remote.postDelayed(hideControls,5000);}
    @Override public void onUserInteraction(){super.onUserInteraction();scheduleHide();}
    private void showControls(){controls.setVisibility(View.VISIBLE);toggle.requestFocus();scheduleHide();}
    @Override public boolean dispatchKeyEvent(KeyEvent event){int code=event.getKeyCode();if((code==KeyEvent.KEYCODE_DPAD_CENTER||code==KeyEvent.KEYCODE_ENTER)&&(centerCaptured||controls!=null&&controls.getVisibility()!=View.VISIBLE)){if(event.getAction()==KeyEvent.ACTION_DOWN){if(event.getRepeatCount()==0){centerCaptured=true;toggle();showControls();}}else if(event.getAction()==KeyEvent.ACTION_UP)centerCaptured=false;return true;}return super.dispatchKeyEvent(event);}
    @Override public boolean onKeyDown(int code,KeyEvent event){
        if(code==KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE||code==KeyEvent.KEYCODE_MEDIA_PLAY||code==KeyEvent.KEYCODE_MEDIA_PAUSE){if(event.getRepeatCount()==0&&controller!=null){if(code==KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)toggle();else controller.setPaused(code==KeyEvent.KEYCODE_MEDIA_PAUSE);}return true;}
        if(code==KeyEvent.KEYCODE_MENU){if(event.getRepeatCount()==0)tracks();return true;}
        if(code==KeyEvent.KEYCODE_MEDIA_REWIND||code==KeyEvent.KEYCODE_MEDIA_FAST_FORWARD||controls.getVisibility()!=View.VISIBLE&&(code==KeyEvent.KEYCODE_DPAD_LEFT||code==KeyEvent.KEYCODE_DPAD_RIGHT)){long now=android.os.SystemClock.uptimeMillis();if(event.getRepeatCount()==0||now-lastSeekKey>=200){lastSeekKey=now;seek((code==KeyEvent.KEYCODE_DPAD_LEFT||code==KeyEvent.KEYCODE_MEDIA_REWIND?-1:1)*(event.getRepeatCount()>8?30000:10000));}return true;}
        if(controls.getVisibility()!=View.VISIBLE&&(code==KeyEvent.KEYCODE_DPAD_UP||code==KeyEvent.KEYCODE_DPAD_DOWN)){showControls();return true;}return super.onKeyDown(code,event);
    }
    @Override public void onBackPressed(){if(controls.getVisibility()==View.VISIBLE){remote.removeCallbacks(hideControls);controls.setVisibility(View.GONE);}else{showControls();AlertDialog prompt=new AlertDialog.Builder(this).setTitle("退出播放？").setMessage("进度会保存在电视本机。").setNegativeButton("继续播放",null).setPositiveButton("退出",(dialog,n)->finish()).create();prompt.setOnShowListener(d->prompt.getButton(AlertDialog.BUTTON_NEGATIVE).requestFocus());prompt.show();}}
    @Override protected void onStop(){remote.removeCallbacksAndMessages(null);centerCaptured=false;if(seekFeedback!=null)seekFeedback.setVisibility(View.GONE);if(controller!=null)controller.stop();super.onStop();}
    @Override protected void onDestroy(){remote.removeCallbacksAndMessages(null);if(controller!=null)controller.close();if(catalog!=null)catalog.close();if(cloudProgress!=null)cloudProgress.close();super.onDestroy();}
}
