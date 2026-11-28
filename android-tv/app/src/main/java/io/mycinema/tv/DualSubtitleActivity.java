package io.mycinema.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import is.xyz.mpv.MPVLib;
import okhttp3.HttpUrl;
import org.json.JSONObject;
import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Opt-in mpv playback with independently selectable primary and secondary subtitles. */
public final class DualSubtitleActivity extends Activity implements SurfaceHolder.Callback {
    private final Handler ui=new Handler();
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final NetworkScope scope=new NetworkScope();
    private final Map<String,Integer> externalTracks=new HashMap<>();
    private final List<File> copies=new ArrayList<>();
    private final String[] properties={"sid","secondary-sid"};
    private final Button[] selectors=new Button[2];
    private MediaCatalog catalog;
    private CloudPlaybackProgress cloud;
    private JSONObject file;
    private String key, variant;
    private long resume;
    private MediaSources.Lease endpoint;
    private SurfaceHolder surface;
    private TextView status;
    private LinearLayout controls;
    private boolean closed, created, initialized, attached;

    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN|WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        key=getIntent().getStringExtra("mediaKey");
        variant=getIntent().getStringExtra("cloudVariant");
        if(variant==null)variant="";
        catalog=new MediaCatalog(this);
        file=catalog.get(key);
        if(file==null){finish();return;}
        resume=getIntent().getLongExtra("position",0);
        if(!variant.isEmpty())cloud=new CloudPlaybackProgress(this);
        FrameLayout root=new FrameLayout(this);
        root.setBackgroundColor(0xff000000);
        SurfaceView video=new SurfaceView(this);
        root.addView(video,new FrameLayout.LayoutParams(-1,-1));
        video.getHolder().addCallback(this);
        controls=new LinearLayout(this);
        controls.setBackgroundColor(0xe0101216);
        controls.setGravity(Gravity.CENTER);
        root.addView(controls,new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM));
        button("播放／暂停",this::pause);
        selectors[0]=button("主字幕",()->choose(0));
        selectors[1]=button("副字幕",()->choose(1));
        button("返回",this::finish);
        status=new TextView(this);
        status.setGravity(Gravity.CENTER);
        status.setTextColor(0xffe9ecf2);
        status.setText("正在连接…");
        root.addView(status,new FrameLayout.LayoutParams(-1,-2,Gravity.CENTER));
        setContentView(root);
        selectors[1].requestFocus();
        worker.execute(this::connect);
    }

    private Button button(String label,Runnable action){
        Button b=new Button(this);
        b.setText(label);
        RemoteUi.button(b);
        b.setOnClickListener(v->action.run());
        controls.addView(b);
        return b;
    }

    private void connect(){
        try{
            MediaSources sources=new MediaSources(this).withScope(scope);
            MediaSources.Lease lease;
            if(!variant.isEmpty()){
                CloudHlsRelay relay=new CloudHlsRelay(sources,file,variant);
                scope.own(relay);
                relay.prepare(scope);
                lease=relay.endpoint();
            }else if("quark".equals(Json.text(file,"source"))){
                PlaybackRelay.Session session=CinemaApplication.dav(this).openPlayback(file,scope);
                scope.own(session);
                lease=session.endpoint;
            }else{
                PlaybackRelay relay=new PlaybackRelay(sources,file);
                scope.own(relay);
                lease=new MediaSources.Lease(HttpUrl.parse(relay.url()),Collections.emptyMap());
            }
            ui.post(()->{if(!closed){endpoint=lease;startIfReady();}});
        }catch(Exception error){notice("媒体源连接失败。");}
    }

    private void notice(String message){ui.post(()->{if(!closed)status.setText(message);});}
    private void option(String name,String value){
        if(MPVLib.setOptionString(name,value)<0)throw new IllegalStateException(name);
    }
    private void configureSubtitleFont(){
        File directory=getDir("mpv-font",MODE_PRIVATE);
        File fallback=new File(directory,"subfont.ttf");
        if(!fallback.exists()){
            // API 21 vendors use different names for the system Chinese fallback.
            for(String name:new String[]{"NotoSansCJK-Regular.ttc","NotoSansHans-Regular.otf",
                    "NotoSansSC-Regular.otf","DroidSansFallback.ttf","Roboto-Regular.ttf"}){
                File font=new File("/system/fonts",name);
                if(!font.canRead())continue;
                try{android.system.Os.symlink(font.getPath(),fallback.getPath());}
                catch(android.system.ErrnoException ignored){continue;}
                break;
            }
        }
        option("config-dir",directory.getPath());
    }

    private void startIfReady(){
        if(closed||surface==null||endpoint==null||created)return;
        try{
            if(!"127.0.0.1".equals(endpoint.url.host()))throw new IllegalStateException();
            MPVLib.create(getApplicationContext());
            created=true;
            option("msg-level","all=no");
            configureSubtitleFont();
            option("demuxer-max-bytes","33554432");option("demuxer-max-back-bytes","4194304");
            option("vo","gpu");option("gpu-context","android");option("opengl-es","yes");
            option("ao","audiotrack");option("hwdec","auto");option("idle","yes");
            option("sub-auto","no");option("access-references","no");
            String auth=endpoint.headers.get("Authorization");
            if(auth!=null)option("http-header-fields","Authorization: "+auth);
            if(resume>0)option("start",Double.toString(resume/1000.0));
            option("sub-pos","90");option("secondary-sub-pos","8");
            MPVLib.init();
            initialized=true;
            attachVideo();
            MPVLib.command(new String[]{"loadfile",endpoint.url.toString()});
            status.setText("");
            ui.postDelayed(tick,1000);
        }catch(RuntimeException|LinkageError error){
            status.setText("双字幕播放器启动失败，请返回继续播放。");
        }
    }

    private final Runnable hide=()->{
        if(initialized&&!Boolean.TRUE.equals(MPVLib.getPropertyBoolean("pause"))&&hasWindowFocus())
            controls.setVisibility(View.GONE);
    };
    private void showControls(){
        controls.setVisibility(View.VISIBLE);
        selectors[0].requestFocus();
        ui.removeCallbacks(hide);ui.postDelayed(hide,5000);
    }
    @Override public void onWindowFocusChanged(boolean focused){
        super.onWindowFocusChanged(focused);
        if(focused)getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        if(focused && controls!=null){ui.removeCallbacks(hide);ui.postDelayed(hide,5000);}
    }
    private final Runnable tick=new Runnable(){
        int count;
        @Override public void run(){
            if(closed||!initialized)return;
            if(++count%5==0)save();
            if(Boolean.TRUE.equals(MPVLib.getPropertyBoolean("eof-reached"))){save();finish();return;}
            ui.postDelayed(this,1000);
        }
    };
    private void save(){
        if(!initialized)return;
        Double t=MPVLib.getPropertyDouble("time-pos"),d=MPVLib.getPropertyDouble("duration");
        if(t==null||d==null||t<0||d<=0)return;
        long position=Boolean.TRUE.equals(MPVLib.getPropertyBoolean("eof-reached"))?0:(long)(t*1000);
        if(cloud==null)catalog.progress(key,position,(long)(d*1000));
        else cloud.save(key,variant,position,(long)(d*1000));
        setResult(RESULT_OK,new Intent().putExtra("position",position));
    }

    private void pause(){
        if(!initialized)return;
        MPVLib.setPropertyBoolean("pause",!Boolean.TRUE.equals(MPVLib.getPropertyBoolean("pause")));
        showControls();
    }

    private void choose(int slot){
        if(!initialized)return;
        List<String> labels=new ArrayList<>(); List<Integer> ids=new ArrayList<>();
        labels.add("关闭");ids.add(-1);
        Integer count=MPVLib.getPropertyInt("track-list/count");
        Integer active=MPVLib.getPropertyInt(properties[slot]);
        int selected=0;
        for(int n=0;count!=null&&n<count;n++){
            String prefix="track-list/"+n+"/";
            if(!"sub".equals(MPVLib.getPropertyString(prefix+"type")))continue;
            Integer id=MPVLib.getPropertyInt(prefix+"id");
            if(id==null)continue;
            boolean ext=Boolean.TRUE.equals(MPVLib.getPropertyBoolean(prefix+"external"));
            String title=MPVLib.getPropertyString(prefix+"title"),lang=MPVLib.getPropertyString(prefix+"lang");
            labels.add((ext?"外挂 ":"内嵌 ")+id+(lang==null?"":" · "+lang)+(title==null?"":" · "+title));
            ids.add(id);
            if(id.equals(active))selected=ids.size()-1;
        }
        labels.add("选择同目录外挂字幕");
        RemoteUi.showList(new AlertDialog.Builder(this).setTitle(slot==0?"选择主字幕":"选择副字幕")
            .setItems(labels.toArray(new String[0]),(dialog,index)->{
                if(index==ids.size())listSidecars(slot);
                else select(slot,ids.get(index));
            }).setNegativeButton("返回",null),selected);
    }
    private void select(int slot,int id){
        selectionEpoch[slot]++;
        if(id>0 && Integer.valueOf(id).equals(MPVLib.getPropertyInt(properties[1-slot]))){
            status.setText("这条轨道已用于另一条字幕。");return;
        }
        MPVLib.command(new String[]{"set",properties[slot],id<0?"no":Integer.toString(id)});
        status.setText("");
    }

    private void listSidecars(int slot){
        worker.execute(()->{
            try{
                List<MediaSources.Entry> files=SubtitleFiles.list(new MediaSources(this).withScope(scope),file);
                ui.post(()->{
                    if(closed)return;
                    if(files.isEmpty()){status.setText("同目录没有可用字幕。");return;}
                    String[] labels=new String[files.size()];
                    for(int i=0;i<labels.length;i++)labels[i]=files.get(i).name;
                    RemoteUi.showList(new AlertDialog.Builder(this).setTitle(slot==0?"主字幕 · 同目录":"副字幕 · 同目录")
                        .setItems(labels,(d,index)->load(slot,files.get(index))).setNegativeButton("返回",null),0);
                });
            }catch(Exception e){notice("无法读取字幕目录。");}
        });
    }
    private final int[] selectionEpoch=new int[2];
    private void load(int slot,MediaSources.Entry entry){
        int epoch=++selectionEpoch[slot];
        Integer known=externalTracks.get(entry.id);
        if(known!=null){select(slot,known);return;}
        worker.execute(()->{
            try{
                File copy=SubtitleFiles.fetch(this,new MediaSources(this).withScope(scope),entry,scope);
                ui.post(()->{
                    if(closed||selectionEpoch[slot]!=epoch){copy.delete();return;}
                    copies.add(copy);
                    String other=MPVLib.getPropertyString(properties[1-slot]);
                    MPVLib.command(new String[]{"sub-add",copy.getAbsolutePath(),"auto",entry.name});
                    if(other!=null)MPVLib.command(new String[]{"set",properties[1-slot],other});
                    Integer count=MPVLib.getPropertyInt("track-list/count");
                    for(int i=0;count!=null&&i<count;i++){
                        String prefix="track-list/"+i+"/";
                        if(copy.getAbsolutePath().equals(MPVLib.getPropertyString(prefix+"external-filename"))){
                            Integer id=MPVLib.getPropertyInt(prefix+"id");
                            if(id!=null){externalTracks.put(entry.id,id);select(slot,id);return;}
                        }
                    }
                    status.setText("无法加载所选字幕。");
                });
            }catch(Exception failure){notice("无法读取所选字幕。");}
        });
    }

    @Override public boolean onKeyDown(int code,KeyEvent event){
        if(code==KeyEvent.KEYCODE_MENU){showControls();return true;}
        if(code==KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE){if(event.getRepeatCount()==0)pause();return true;}
        if(initialized && controls.getVisibility()!=View.VISIBLE){
            if(code==KeyEvent.KEYCODE_DPAD_LEFT||code==KeyEvent.KEYCODE_DPAD_RIGHT){
                MPVLib.command(new String[]{"seek",code==KeyEvent.KEYCODE_DPAD_LEFT?"-10":"10","relative+exact"});return true;
            }
            if(code==KeyEvent.KEYCODE_DPAD_CENTER||code==KeyEvent.KEYCODE_DPAD_UP||code==KeyEvent.KEYCODE_DPAD_DOWN){showControls();return true;}
        }
        return super.onKeyDown(code,event);
    }
    @Override public void onBackPressed(){
        if(controls.getVisibility()==View.VISIBLE)controls.setVisibility(View.GONE);
        else super.onBackPressed();
    }

    private void attachVideo(){
        MPVLib.attachSurface(surface.getSurface());
        attached=true;
        option("force-window","yes");
        MPVLib.setPropertyString("vo","gpu");
        android.graphics.Rect frame=surface.getSurfaceFrame();
        if(frame.width()>0 && frame.height()>0)
            MPVLib.setPropertyString("android-surface-size",frame.width()+"x"+frame.height());
    }

    @Override public void surfaceCreated(SurfaceHolder holder){
        surface=holder;
        if(initialized && !closed)attachVideo();
        else startIfReady();
    }
    @Override public void surfaceChanged(SurfaceHolder h,int format,int width,int height){
        if(attached)MPVLib.setPropertyString("android-surface-size",width+"x"+height);
    }
    @Override public void surfaceDestroyed(SurfaceHolder holder){
        if(attached){
            MPVLib.setPropertyString("vo","null");
            MPVLib.setOptionString("force-window","no");
            MPVLib.detachSurface();
            attached=false;
        }
        surface=null;
    }
    private void shutdown(){
        if(closed)return;
        closed=true;ui.removeCallbacksAndMessages(null);
        save();
        scope.close();
        if(created){
            if(attached){MPVLib.detachSurface();attached=false;}
            MPVLib.destroy();
            initialized=false;
            created=false;
        }
        worker.shutdownNow();
        for(File copy:copies)copy.delete();
        if(catalog!=null)catalog.close();
        if(cloud!=null)cloud.close();
    }
    @Override protected void onStop(){shutdown();finish();super.onStop();}
    @Override protected void onDestroy(){shutdown();super.onDestroy();}
}
