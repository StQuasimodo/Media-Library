package is.xyz.mpv;

import android.content.Context;
import android.view.Surface;

/** JNI bridge for the pinned mpv-android build. */
public final class MPVLib {
    static { System.loadLibrary("mpv"); System.loadLibrary("player"); }
    public static native void create(Context context);
    public static native void init();
    public static native void destroy();
    public static native void attachSurface(Surface surface);
    public static native void detachSurface();
    public static native Boolean getPropertyBoolean(String name);
    public static native int setOptionString(String name,String value);
    public static native void command(String[] command);
    public static native Double getPropertyDouble(String name);
    public static native Integer getPropertyInt(String name);
    public static native void setPropertyString(String name,String value);
    public static native String getPropertyString(String name);
    public static native void setPropertyBoolean(String name,Boolean value);
    public static void eventProperty(String name) {}
    public static void eventProperty(String name,boolean value) {}
    public static void eventProperty(String name,long value) {}
    public static void eventProperty(String name,double value) {}
    public static void eventProperty(String name,String value) {}
    public static void event(int id) {}
    public static void logMessage(String prefix,int level,String message) {}
}
