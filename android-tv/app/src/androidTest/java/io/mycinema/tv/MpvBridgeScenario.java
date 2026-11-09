package io.mycinema.tv;

import android.app.Activity;
import android.app.Instrumentation;
import android.graphics.Bitmap;
import android.view.KeyEvent;
import android.view.SurfaceView;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import is.xyz.mpv.MPVLib;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import okhttp3.Request;
import okhttp3.Response;

/** Test-only render and remote-control experiment over the app's scoped loopback lease. */
final class MpvBridgeScenario {
    private interface Condition { boolean ok(); }
    private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    private static void await(Condition condition,String label) throws Exception {
        long end=System.currentTimeMillis()+30000;
        while(System.currentTimeMillis()<end){if(condition.ok())return;Thread.sleep(250);}
        throw new AssertionError("timeout: "+label);
    }
    private static double time(MPVLib mpv){Double t=mpv.getPropertyDouble("time-pos");return t==null?-1:t;}
    private static void option(MPVLib mpv,String key,String value){check(mpv.setOptionString(key,value)>=0,"mpv option "+key);}
    static void run(Instrumentation test,Activity activity,JSONObject file) throws Exception {
        NetworkScope scope=new NetworkScope();PlaybackRelay.Session session=null;MPVLib mpv=null;boolean created=false,attached=false;
        final SurfaceView[] surface={null};
        try{
            session=CinemaApplication.dav(activity).openPlayback(file,scope);
            check("127.0.0.1".equals(session.endpoint.url.host()),"mpv source is loopback");
            mpv=new MPVLib();final MPVLib engine=mpv;mpv.create(activity.getApplicationContext());created=true;
            option(mpv,"msg-level","all=no");option(mpv,"vo","gpu");option(mpv,"gpu-context","android");option(mpv,"opengl-es","yes");option(mpv,"ao","null");
            option(mpv,"hwdec","auto");option(mpv,"hwdec-software-fallback","1");
            option(mpv,"http-header-fields","Authorization: "+session.endpoint.headers.get("Authorization"));
            option(mpv,"idle","yes");mpv.init();
            test.runOnMainSync(()->{
                SurfaceView view=new SurfaceView(activity);view.setFocusable(true);view.setFocusableInTouchMode(true);
                view.setOnKeyListener((v,key,event)->{
                    if(event.getAction()!=KeyEvent.ACTION_DOWN)return key==KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE||key==KeyEvent.KEYCODE_DPAD_RIGHT;
                    if(key==KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE){Boolean paused=engine.getPropertyBoolean("pause");engine.setPropertyBoolean("pause",paused==null||!paused);return true;}
                    if(key==KeyEvent.KEYCODE_DPAD_RIGHT){engine.command(new String[]{"seek","10","relative+exact"});return true;}
                    return false;
                });
                activity.addContentView(view,new FrameLayout.LayoutParams(-1,-1));view.requestFocus();surface[0]=view;
            });
            await(()->surface[0]!=null&&surface[0].getHolder().getSurface().isValid(),"mpv rendering surface");
            mpv.attachSurface(surface[0].getHolder().getSurface());attached=true;option(mpv,"force-window","yes");
            mpv.command(new String[]{"loadfile",session.endpoint.url.toString()});
            await(()->time(engine)>1.5,"mpv advances on scoped Quark stream");
            await(()->{Integer w=engine.getPropertyInt("width"),h=engine.getPropertyInt("height");return w!=null&&h!=null&&w==1920&&h==1080;},"mpv video dimensions");
            Thread.sleep(2000);Bitmap image=test.getUiAutomation().takeScreenshot();check(image!=null,"app screenshot");
            try{
                int colorful=0,total=0;for(int y=0;y<image.getHeight();y+=12)for(int x=0;x<image.getWidth();x+=12){int c=image.getPixel(x,y),r=(c>>16)&255,g=(c>>8)&255,b=c&255;total++;if(Math.max(r,Math.max(g,b))-Math.min(r,Math.min(g,b))>70&&Math.max(r,Math.max(g,b))>100)colorful++;}
                check(colorful>total/25,"video test pattern visible in app screenshot");
                try(FileOutputStream out=new FileOutputStream(new File(activity.getFilesDir(),"mpv-quark-render.png"))){image.compress(Bitmap.CompressFormat.PNG,100,out);}
            }finally{image.recycle();}
            test.sendKeyDownUpSync(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);Thread.sleep(800);double paused=time(mpv);Thread.sleep(800);
            check(Boolean.TRUE.equals(mpv.getPropertyBoolean("pause"))&&Math.abs(time(mpv)-paused)<0.5,"remote pause holds");
            test.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_RIGHT);final double expected=paused+10;
            await(()->Math.abs(time(engine)-expected)<1.5,"remote seek through scoped relay");
            test.sendKeyDownUpSync(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);await(()->time(engine)>expected+1,"remote resume after seek");
            mpv.detachSurface();attached=false;mpv.destroy();created=false;
            okhttp3.HttpUrl url=session.endpoint.url;String auth=session.endpoint.headers.get("Authorization");session.close();session=null;
            try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url(url).header("Authorization",auth).build()).execute()){
                check(response.code()==401,"closing session revokes mpv access");
            }
        }finally{
            if(attached&&mpv!=null)mpv.detachSurface();if(created&&mpv!=null)mpv.destroy();
            if(surface[0]!=null)test.runOnMainSync(()->{if(surface[0].getParent() instanceof ViewGroup)((ViewGroup)surface[0].getParent()).removeView(surface[0]);});
            if(session!=null)session.close();scope.close();
        }
    }
}
