package io.mycinema.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;
import java.util.ArrayList;
import java.util.Locale;

/** One embedded decoder, own remote-first controls; intents carry only stable catalog IDs. */
public final class PlayerActivity extends Activity {
    private final Handler handler=new Handler();private MediaCatalog catalog;private JSONObject file;
    private LibVLC vlc;private MediaPlayer player;private PlaybackRelay relay;private VLCVideoLayout video;
    private TextView title,status;private LinearLayout controls;private Button toggle;
    private long resume;private boolean resumed,failed,ended;private int ticks;
    private final Runnable timer=new Runnable(){@Override public void run(){if(player==null)return;long time=player.getTime(),length=player.getLength();if(!failed)status.setText(clock(time)+" / "+clock(length)+"   ·   左右键 ±10秒 · 确认 暂停/播放 · 菜单 音轨/字幕");if(++ticks%5==0)save();handler.postDelayed(this,1000);}};
    @Override public void onCreate(Bundle state){
        super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN|WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        catalog=new MediaCatalog(this);file=catalog.get(getIntent().getStringExtra("mediaKey"));if(file==null){finish();return;}resume=catalog.position(Json.text(file,"key"));
        FrameLayout root=new FrameLayout(this);root.setBackgroundColor(0xff000000);video=new VLCVideoLayout(this);root.addView(video,new FrameLayout.LayoutParams(-1,-1));
        controls=new LinearLayout(this);controls.setOrientation(LinearLayout.VERTICAL);controls.setPadding(24,12,24,18);controls.setBackgroundColor(0xdd101216);FrameLayout.LayoutParams params=new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM);root.addView(controls,params);
        title=new TextView(this);title.setTextColor(MainActivity.PRIMARY);title.setTextSize(18);title.setText(Json.text(file,"name"));controls.addView(title);status=new TextView(this);status.setTextColor(MainActivity.PRIMARY);status.setTextSize(14);controls.addView(status);
        LinearLayout actions=new LinearLayout(this);toggle=button("暂停 / 播放",this::toggle);actions.addView(toggle);actions.addView(button("后退10秒",()->seek(-10000)));actions.addView(button("前进10秒",()->seek(10000)));actions.addView(button("音轨 / 字幕",this::tracks));actions.addView(button("退出播放",this::finish));controls.addView(actions);setContentView(root);toggle.requestFocus();
    }
    @Override protected void onStart(){super.onStart();if(file==null)return;try{
        failed=false;resumed=false;ended=false;relay=new PlaybackRelay(new MediaSources(this),file);ArrayList<String> options=new ArrayList<>();options.add("--quiet");options.add("--no-video-title-show");options.add("--network-caching=1500");vlc=new LibVLC(this,options);player=new MediaPlayer(vlc);player.attachViews(video,null,false,false);
        player.setEventListener(event->{if(player==null)return;if(event.type==MediaPlayer.Event.Playing){if(!resumed&&resume>0)player.setTime(resume);resumed=true;status.setText("正在播放");}if(event.type==MediaPlayer.Event.EncounteredError){failed=true;String reason=relay==null?"":relay.error();status.setText(reason.isEmpty()?"无法播放该资源，请检查连接或更换电视支持的编码版本。":reason);}if(event.type==MediaPlayer.Event.EndReached){ended=true;resume=0;catalog.progress(Json.text(file,"key"),0,player.getLength());status.setText("播放完毕");}});
        Media media=new Media(vlc,android.net.Uri.parse(relay.url()));media.setHWDecoderEnabled(true,false);try{player.setMedia(media);}finally{media.release();}status.setText("正在连接媒体源…");player.play();handler.postDelayed(timer,1000);
    }catch(Exception|LinkageError error){failed=true;status.setText("播放器初始化失败，该设备可能不兼容。请返回并反馈设备型号。");release();}}
    private Button button(String text,Runnable action){Button button=new Button(this);button.setText(text);button.setAllCaps(false);button.setTextSize(13);button.setOnClickListener(view->action.run());return button;}
    private void toggle(){if(player==null)return;if(player.isPlaying())player.pause();else player.play();}
    private void seek(long delta){if(player==null)return;if(!player.isSeekable()){status.setText("当前媒体源尚不支持定位，或仍在缓冲。");return;}long duration=player.getLength(),target=Math.max(0,player.getTime()+delta);player.setTime(duration>0?Math.min(target,Math.max(0,duration-1000)):target);controls.setVisibility(View.VISIBLE);}
    private static String clock(long value){long seconds=Math.max(0,value)/1000;return String.format(Locale.ROOT,"%d:%02d:%02d",seconds/3600,(seconds/60)%60,seconds%60);}
    private void tracks(){if(player==null)return;new AlertDialog.Builder(this).setTitle("播放选项").setItems(new String[]{"选择音轨","选择字幕"},(dialog,index)->selectTracks(index==0)).setNegativeButton("返回",null).show();}
    private void selectTracks(boolean audio){if(player==null)return;MediaPlayer.TrackDescription[] tracks=audio?player.getAudioTracks():player.getSpuTracks();if(tracks==null||tracks.length==0){status.setText(audio?"此资源没有可选音轨。":"此资源没有内嵌字幕；外挂字幕将在后续支持。");return;}String[] labels=new String[tracks.length];for(int i=0;i<tracks.length;i++)labels[i]=tracks[i].id==-1?"关闭字幕":tracks[i].name;new AlertDialog.Builder(this).setTitle(audio?"音轨":"字幕").setItems(labels,(dialog,n)->{if(player!=null){if(audio)player.setAudioTrack(tracks[n].id);else player.setSpuTrack(tracks[n].id);}}).setNegativeButton("返回",null).show();}
    @Override public boolean onKeyDown(int code,KeyEvent event){if(code==KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE){toggle();return true;}if(code==KeyEvent.KEYCODE_MENU){tracks();return true;}if(controls.getVisibility()!=View.VISIBLE){if(code==KeyEvent.KEYCODE_DPAD_LEFT){seek(-10000);return true;}if(code==KeyEvent.KEYCODE_DPAD_RIGHT){seek(10000);return true;}if(code==KeyEvent.KEYCODE_DPAD_CENTER||code==KeyEvent.KEYCODE_ENTER){toggle();controls.setVisibility(View.VISIBLE);return true;}if(code==KeyEvent.KEYCODE_DPAD_UP||code==KeyEvent.KEYCODE_DPAD_DOWN){controls.setVisibility(View.VISIBLE);toggle.requestFocus();return true;}}return super.onKeyDown(code,event);}
    @Override public void onBackPressed(){if(controls.getVisibility()==View.VISIBLE){controls.setVisibility(View.GONE);}else{controls.setVisibility(View.VISIBLE);new AlertDialog.Builder(this).setTitle("退出播放？").setMessage("进度会保存在电视本机。").setNegativeButton("继续播放",null).setPositiveButton("退出",(dialog,n)->finish()).show();}}
    private void save(){if(player!=null&&file!=null&&resumed&&!ended){long time=player.getTime();resume=time;catalog.progress(Json.text(file,"key"),time,player.getLength());}}
    private void release(){handler.removeCallbacks(timer);if(relay!=null){relay.close();relay=null;}if(player!=null){player.setEventListener(null);player.stop();player.detachViews();player.release();player=null;}if(vlc!=null){vlc.release();vlc=null;}}
    @Override protected void onStop(){save();release();super.onStop();}
    @Override protected void onDestroy(){release();if(catalog!=null)catalog.close();super.onDestroy();}
}
