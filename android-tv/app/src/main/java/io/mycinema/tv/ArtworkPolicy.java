package io.mycinema.tv;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Keep in step with desktop metadata/artwork.ts. No episode stills or generic zh posters. */
final class ArtworkPolicy {
    private static boolean valid(JSONObject image) {
        double width=image.optDouble("width",0),height=image.optDouble("height",0);
        return Json.text(image,"file_path").matches("/[a-zA-Z0-9_.-]+")&&width>0&&height>0&&!Double.isInfinite(width)&&!Double.isInfinite(height);
    }
    private static double score(JSONObject image,double ratio) {
        double count=Math.max(0,Math.min(image.optDouble("vote_count",0),10000));
        double average=Math.max(0,Math.min(image.optDouble("vote_average",0),10));
        return (average*count+6*20)/(count+20)*10+Math.min(image.optDouble("width")/(ratio>1?1920:1000),2)*8-Math.abs(image.optDouble("width")/image.optDouble("height")-ratio)*12;
    }
    private static List<JSONObject> ordered(List<JSONObject> images,double ratio) {
        Collections.sort(images,(a,b)->{int order=Double.compare(score(b,ratio),score(a,ratio));return order!=0?order:Json.text(a,"file_path").compareTo(Json.text(b,"file_path"));});
        List<JSONObject> result=new ArrayList<>();Set<String> seen=new HashSet<>();
        for(JSONObject image:images)if(seen.add(Json.text(image,"file_path")))result.add(image);return result;
    }
    static String poster(JSONArray images) {
        List<JSONObject> allowed=new ArrayList<>(),simplified=new ArrayList<>();
        for(int i=0;i<images.length();i++){
            JSONObject image=images.optJSONObject(i);if(image==null||!valid(image))continue;
            double width=image.optDouble("width"),height=image.optDouble("height"),ratio=width/height;
            String language=Json.text(image,"iso_639_1");
            boolean cn=language.equals("zh-Hans")||language.equals("zh-CN")||(language.equals("zh")&&Json.text(image,"iso_3166_1").equals("CN"));
            if((language.equals("en")||cn)&&width>=400&&height>=600&&ratio>=0.55&&ratio<=0.85){allowed.add(image);if(cn)simplified.add(image);}
        }
        List<JSONObject> ranked=ordered(simplified.isEmpty()?allowed:simplified,2.0/3);return ranked.isEmpty()?null:Json.text(ranked.get(0),"file_path");
    }
    static String backdrop(JSONArray images,int season) {
        List<JSONObject> allowed=new ArrayList<>(),textless=new ArrayList<>();
        for(int i=0;i<images.length();i++){
            JSONObject image=images.optJSONObject(i);if(image==null||!valid(image))continue;
            double width=image.optDouble("width"),height=image.optDouble("height"),ratio=width/height;
            boolean noText=image.has("iso_639_1")&&image.isNull("iso_639_1");
            if((noText||Json.text(image,"iso_639_1").equals("en"))&&width>=1280&&height>=720&&ratio>=1.5&&ratio<=2.05&&!(image.optInt("vote_count",0)>0&&image.optDouble("vote_average",0)<4)){
                allowed.add(image);if(noText)textless.add(image);
            }
        }
        List<JSONObject> ranked=ordered(textless.isEmpty()?allowed:textless,16.0/9);if(ranked.isEmpty())return null;
        double best=score(ranked.get(0),16.0/9);List<JSONObject> pool=new ArrayList<>();
        for(JSONObject image:ranked)if(pool.size()<8&&score(image,16.0/9)>=best-12)pool.add(image);
        return Json.text(pool.get(season<0?0:Math.max(0,season-1)%pool.size()),"file_path");
    }
}
