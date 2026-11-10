package io.mycinema.tv;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.os.Bundle;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Shared filename fixtures and the real API22 SQLite catalog; no network or decoder required. */
final class ResourceNameScenario {
    private final Instrumentation test;private final Context context;
    ResourceNameScenario(Instrumentation test){this.test=test;context=test.getTargetContext();}
    private void check(boolean value,String label){if(!value)throw new AssertionError(label);}
    private Library.Item item(String id,String title,String type,int number){
        JSONObject film=new JSONObject();Json.put(film,"id",id);Json.put(film,"title",title);Json.put(film,"originalTitle",title);Json.put(film,"mediaType",type);
        if(type.equals("tv"))Json.put(film,"externalId","1396:season:"+number);else Json.put(film,"year",number);
        return new Library.Item(film,new JSONObject());
    }
    private MediaSources.Entry file(String id,String name){return new MediaSources.Entry("parser-fixture",id,name,"parser-folder",false,1024);}
    void run(String buildRun){
        JSONObject report=new JSONObject();Bundle result=new Bundle();JSONArray passed=new JSONArray();Json.put(report,"buildRun",buildRun);Json.put(report,"apiLevel",android.os.Build.VERSION.SDK_INT);
        try{
            JSONObject fixtures;
            try(InputStream input=test.getContext().getAssets().open("resource-name-cases.json")){
                byte[] bytes=TmdbClient.read(input,128*1024);fixtures=Json.object(new String(bytes,StandardCharsets.UTF_8));
                StringBuilder hash=new StringBuilder();for(byte value:java.security.MessageDigest.getInstance("SHA-256").digest(bytes))hash.append(String.format(java.util.Locale.ROOT,"%02x",value&255));Json.put(report,"fixtureSha256",hash.toString());
            }
            for(String group:new String[]{"shared","tvOnly"}){
                JSONArray cases=fixtures.getJSONArray(group);
                for(int i=0;i<cases.length();i++){
                    JSONObject sample=cases.getJSONObject(i),expected=sample.getJSONObject("hint");String id=Json.text(sample,"id");JSONArray parents=sample.optJSONArray("parents");String parent=parents==null||parents.length()==0?"":parents.getString(parents.length()-1);
                    JSONObject actual=ResourceName.hint(Json.text(sample,"filename"),parent);
                    check(Json.text(actual,"title").equals(Json.text(expected,"title")),id+": title was "+Json.text(actual,"title"));
                    check(Json.text(actual,"year").equals(expected.isNull("year")?"":String.valueOf(expected.getInt("year"))),id+": year");
                    for(String field:new String[]{"season","episode"}){
                        boolean known=!expected.isNull(field);check(actual.optBoolean(field+"Known")==known,id+": "+field+" presence");
                        if(known)check(actual.optInt(field)==expected.getInt(field),id+": "+field+" value");
                    }
                    JSONObject facts=sample.optJSONObject("facts");if(facts!=null)for(java.util.Iterator<String> keys=facts.keys();keys.hasNext();){String key=keys.next();check(Json.text(actual,key).equals(Json.text(facts,key)),id+": "+key+" was "+Json.text(actual,key));}
                    passed.put(id);
                }
            }
            List<Library.Item> seasons=Arrays.asList(item("bb0","Breaking Bad","tv",0),item("bb1","Breaking Bad","tv",1),item("bb2","Breaking Bad","tv",2));
            check(ResourceName.match("Breaking.Bad.S00E01.1080p.mkv","Season 01",seasons).equals("bb0"),"explicit specials beat parent season");
            check(ResourceName.match("Breaking.Bad.E01.mp4","Season 00",seasons).equals("bb0"),"unknown season inherits explicit parent zero");
            check(ResourceName.match("Breaking.Bad.E01.mp4","",seasons).isEmpty(),"unknown season is not assumed to be specials");
            check(ResourceName.match("Breaking.Bad.S00E01.mp4","",Arrays.asList(seasons.get(0),seasons.get(0))).isEmpty(),"ambiguous specials remain unassociated");
            check(ResourceName.match("Breaking.Bad.S00E01.mp4","",Arrays.asList(item("movie-bb","Breaking Bad","movie",2008))).isEmpty(),"explicit season zero cannot match a movie");
            List<Library.Item> movies=Arrays.asList(item("movie-1917","1917","movie",2019),item("paddington","Paddington","movie",2014));
            check(ResourceName.match("1917.2019.1080p.mkv","",movies).equals("movie-1917"),"numeric movie title matches correct year");
            check(ResourceName.match("1917.2020.1080p.mkv","",movies).isEmpty(),"year conflict remains unassociated");
            check(ResourceName.match("Paddington.2014.1080p.AAC.mkv","",movies).equals("paddington"),"audio abbreviation does not truncate movie matching");
            Json.put(report,"matchingChecks",8);

            try(MediaCatalog catalog=new MediaCatalog(context)){
                MediaSources.Entry manual=file("manual","Paddington.2014.1080p.AAC.mkv");catalog.put(manual,"automatic");catalog.associate(manual.key(),"user-choice");catalog.progress(manual.key(),60000,180000);
                JSONObject refreshed=catalog.put(file("manual","1917.2019.2160p.HEVC.mkv"),"movie-1917");
                check(Json.text(refreshed,"filmId").equals("user-choice")&&refreshed.optBoolean("associationManual"),"rescan keeps manual association");
                check(Json.text(refreshed.getJSONObject("info"),"title").equals("1917"),"rescan refreshes filename facts without overriding association");
                catalog.put(file("unlinked","Breaking.Bad.S00E01.mkv"),"bb1");catalog.associate("parser-fixture:unlinked","");
                check(Json.text(catalog.put(file("unlinked","Breaking.Bad.S00E01.mkv"),"bb0"),"filmId").isEmpty(),"manual unlink survives corrected matching");
                catalog.put(file("existing-auto","Breaking.Bad.S00E01.mkv"),"bb1");
                check(Json.text(catalog.put(file("existing-auto","Breaking.Bad.S00E01.mkv"),"bb0"),"filmId").equals("bb1"),"existing automatic associations are not silently rewritten");
            }
            try(MediaCatalog reopened=new MediaCatalog(context)){
                check(reopened.position("parser-fixture:manual")==60000&&Json.text(reopened.get("parser-fixture:manual"),"filmId").equals("user-choice"),"progress and manual association survive reopen");
            }
            Json.put(report,"catalogPreservationChecks",5);Json.put(report,"fixtureCases",passed);Json.put(report,"fixtureCount",passed.length());Json.put(report,"runtimeAbi",android.os.Build.CPU_ABI);Json.put(report,"realQuarkAccountVerified",false);Json.put(report,"physicalTelevisionVerified",false);Json.put(report,"result","passed");
            result.putString("result","passed");
        }catch(Throwable failure){Json.put(report,"result","failed");Json.put(report,"error",failure.toString());Json.put(report,"fixtureCases",passed);result.putString("result","failed");result.putString("error",failure.toString());}
        finally{
            try(MediaCatalog catalog=new MediaCatalog(context)){catalog.forget("parser-fixture");}catch(Exception ignored){}
            try(FileOutputStream output=new FileOutputStream(new File(context.getFilesDir(),"tv-resource-name-report.json"))){output.write(report.toString(2).getBytes(StandardCharsets.UTF_8));}catch(Exception error){result.putString("result","failed");result.putString("error","Cannot write parser test report");}
            test.finish("passed".equals(result.getString("result"))?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);
        }
    }
}
