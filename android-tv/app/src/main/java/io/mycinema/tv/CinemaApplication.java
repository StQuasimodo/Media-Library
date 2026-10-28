package io.mycinema.tv;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;
import android.os.Handler;

/** Owns the TV-local gateway while My Cinema is visible, without an external host. */
public final class CinemaApplication extends Application {
    private QuarkDavManager dav;private int visible;private final Handler handler=new Handler();
    private final Runnable stop=()->{if(visible==0&&dav!=null)dav.stop();};
    static QuarkDavManager dav(android.content.Context context){return ((CinemaApplication)context.getApplicationContext()).dav();}
    private synchronized QuarkDavManager dav(){if(dav==null)dav=new QuarkDavManager(this);return dav;}
    @Override public void onCreate(){super.onCreate();registerActivityLifecycleCallbacks(new ActivityLifecycleCallbacks(){
        @Override public void onActivityStarted(Activity activity){visible++;handler.removeCallbacks(stop);}
        @Override public void onActivityStopped(Activity activity){visible=Math.max(0,visible-1);if(visible==0)handler.postDelayed(stop,1500);}
        @Override public void onActivityCreated(Activity activity,Bundle state){}
        @Override public void onActivityResumed(Activity activity){}
        @Override public void onActivityPaused(Activity activity){}
        @Override public void onActivitySaveInstanceState(Activity activity,Bundle state){}
        @Override public void onActivityDestroyed(Activity activity){}
    });}
    @Override public void onLowMemory(){if(visible==0&&dav!=null)dav.stop();super.onLowMemory();}
}
