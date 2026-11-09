package is.xyz.mpv;

import android.content.Context;
import android.view.Surface;

/** Test-only JNI declarations matching mpv-android at 3018d472. No native library is shipped in the app. */
public final class MPVLib {
    static { System.loadLibrary("mpv"); System.loadLibrary("player"); }
    public native void create(Context context);
    public native void init();
    public native void destroy();
    public native void attachSurface(Surface surface);
    public native void detachSurface();
    public native Boolean getPropertyBoolean(String name);
    public native int setOptionString(String name,String value);
    public native void command(String[] command);
    public native Double getPropertyDouble(String name);
    public native Integer getPropertyInt(String name);
    public native void setPropertyInt(String name,int value);
    public native String getPropertyString(String name);
    public native void setPropertyBoolean(String name,boolean value);
    public static void eventProperty(String name) {}
    public static void eventProperty(String name,boolean value) {}
    public static void eventProperty(String name,long value) {}
    public static void eventProperty(String name,double value) {}
    public static void eventProperty(String name,String value) {}
    public static void event(int id) {}
    public static void logMessage(String prefix,int level,String message) {}
}
