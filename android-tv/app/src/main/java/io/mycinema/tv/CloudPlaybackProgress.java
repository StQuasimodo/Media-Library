package io.mycinema.tv;

import android.content.Context;
import android.content.SharedPreferences;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Experimental timeline is separate from original-file progress and contains no routing data. */
final class CloudPlaybackProgress {
    private final SharedPreferences prefs;
    CloudPlaybackProgress(Context context){prefs=context.getSharedPreferences("cloud-hls-progress-v1",Context.MODE_PRIVATE);}
    private static String key(String media,String selector){try{byte[] bytes=MessageDigest.getInstance("SHA-256").digest((media+"\0"+selector).getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}catch(Exception impossible){throw new IllegalStateException();}}
    long position(String media,String selector){String key=key(media,selector);long position=prefs.getLong(key+"-p",0),duration=prefs.getLong(key+"-d",0);return duration>0&&duration-position<15000?0:position;}
    synchronized void save(String media,String selector,long position,long duration){
        if(position<0||duration<0)return;String key=key(media,selector);SharedPreferences.Editor editor=prefs.edit();
        editor.putLong(key+"-p",position).putLong(key+"-d",duration).apply();
    }
}
