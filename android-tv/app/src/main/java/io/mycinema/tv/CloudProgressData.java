package io.mycinema.tv;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;

/** Portable hashed timeline data only; neither URLs nor decoder/account options are accepted. */
final class CloudProgressData {
    static final int MAX_ROWS=10000;
    static String key(String media,String selector){
        try{byte[] bytes=MessageDigest.getInstance("SHA-256").digest((media+"\0"+selector).getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte value:bytes)out.append(String.format(Locale.ROOT,"%02x",value&255));return out.toString();}
        catch(Exception impossible){throw new IllegalStateException(impossible);}
    }
    private static IllegalArgumentException invalid(){return new IllegalArgumentException("云端播放进度格式无效，原数据保留。");}
    private static long time(Object value){if(!(value instanceof Long)&&!(value instanceof Integer))throw invalid();long result=((Number)value).longValue();if(result<0)throw invalid();return result;}
    static JSONObject row(String key,Object position,Object duration){
        if(key==null||!key.matches("[0-9a-f]{64}"))throw invalid();JSONObject row=new JSONObject();Json.put(row,"key",key);Json.put(row,"position",time(position));Json.put(row,"duration",time(duration));return row;
    }
    static JSONArray clean(JSONArray rows){
        if(rows==null||rows.length()>MAX_ROWS)throw invalid();Set<String> seen=new HashSet<>();List<JSONObject> clean=new ArrayList<>();
        for(int i=0;i<rows.length();i++){
            JSONObject input=rows.optJSONObject(i);if(input==null||!(input.opt("key") instanceof String))throw invalid();String key=input.optString("key");if(!seen.add(key))throw invalid();clean.add(row(key,input.opt("position"),input.opt("duration")));
        }
        Collections.sort(clean,(a,b)->Json.text(a,"key").compareTo(Json.text(b,"key")));JSONArray result=new JSONArray();for(JSONObject row:clean)result.put(row);return result;
    }
    static JSONArray legacy(Map<String,?> values){
        Set<String> keys=new TreeSet<>();for(String name:values.keySet())if(name.matches("[0-9a-f]{64}-[pd]"))keys.add(name.substring(0,64));JSONArray result=new JSONArray();
        // Do not truncate pre-existing local history to the portable backup's row limit.
        for(String key:keys)result.put(row(key,values.containsKey(key+"-p")?values.get(key+"-p"):0L,values.containsKey(key+"-d")?values.get(key+"-d"):0L));return result;
    }
}
