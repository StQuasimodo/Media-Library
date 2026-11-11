package io.mycinema.tv;
import android.content.Context;
import org.json.JSONArray;
import java.util.ArrayList;
import java.util.List;
/** Search terms only, never credentials; bounded local history removable from the remote. */
final class SearchHistory {
    private final android.content.SharedPreferences prefs;
    SearchHistory(Context context){prefs=context.getSharedPreferences("search-history",Context.MODE_PRIVATE);}
    List<String> list(){List<String> result=new ArrayList<>();try{JSONArray data=new JSONArray(prefs.getString("queries","[]"));for(int i=0;i<Math.min(12,data.length());i++){String term=data.optString(i).trim();if(!term.isEmpty()&&term.length()<=120&&!result.contains(term))result.add(term);}}catch(Exception ignored){}return result;}
    void add(String value){String term=value.trim();if(term.isEmpty()||term.length()>120)return;List<String> list=list();list.remove(term);list.add(0,term);prefs.edit().putString("queries",new JSONArray(list.subList(0,Math.min(12,list.size()))).toString()).apply();}
    void clear(){prefs.edit().remove("queries").apply();}
}
