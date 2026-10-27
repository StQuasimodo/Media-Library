package io.mycinema.tv;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

final class Json {
    static JSONObject object(String value) {
        try { return new JSONObject(value); }
        catch (JSONException e) { throw new IllegalArgumentException("资料格式无效。"); }
    }
    static JSONObject copy(JSONObject value) { return object(value.toString()); }
    static JSONObject put(JSONObject value, String key, Object item) {
        try { value.put(key, item == null ? JSONObject.NULL : item); return value; }
        catch (JSONException e) { throw new IllegalArgumentException("资料字段无效。"); }
    }
    static String text(JSONObject value, String key) {
        Object item=value.opt(key); return item instanceof String ? (String)item : "";
    }
    static JSONArray array(JSONObject value, String key) { JSONArray result=value.optJSONArray(key); return result==null ? new JSONArray() : result; }
    static String now() {
        SimpleDateFormat format=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC")); return format.format(new Date());
    }
}
