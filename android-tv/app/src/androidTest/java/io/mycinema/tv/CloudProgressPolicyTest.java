package io.mycinema.tv;

import java.util.*;
import org.json.*;

/** Shared host/API22 checks for portable timeline validation and non-destructive legacy conversion. */
public final class CloudProgressPolicyTest {
    private static void check(List<String> checks,boolean ok,String label){if(!ok)throw new AssertionError(label);checks.add(label);}
    private static JSONObject row(){return CloudProgressData.row(CloudProgressData.key("quark:movie-file","high|1920|1080|h264|aac|2|HLS"),40000L,180000L);}
    public static List<String> run()throws Exception {
        List<String> checks=new ArrayList<>();String hash=CloudProgressData.key("quark:movie-file","high|1920|1080|h264|aac|2|HLS");
        check(checks,hash.equals("ddab88edbb13334c36fdc163168cdc0069a4c34fc3d47dccedba1f984b8da4cb"),"cloud timeline identity remains a stable SHA256 digest without routing data");
        check(checks,!hash.equals(CloudProgressData.key("quark:other-file","high|1920|1080|h264|aac|2|HLS"))&&!hash.equals(CloudProgressData.key("quark:movie-file","normal|1280|720|h264|aac|2|HLS")),"media identities and cloud versions keep separate timelines");
        check(checks,CloudProgressData.clean(new JSONArray()).length()==0,"explicit empty cloud backup is valid");
        JSONObject base=row(),extra=Json.copy(base);Json.put(extra,"Cookie","cloud-private-cookie");Json.put(extra,"url","https://cdn.example/movie?token=cloud-private-token");JSONArray cleaned=CloudProgressData.clean(new JSONArray().put(extra));
        check(checks,cleaned.getJSONObject(0).getLong("position")==40000&&cleaned.getJSONObject(0).getLong("duration")==180000,"portable cloud progress preserves exact numeric values");
        check(checks,!cleaned.toString().contains("cloud-private")&&!cleaned.toString().contains("https://")&&cleaned.getJSONObject(0).length()==3,"unknown fields including credentials and URLs are stripped");
        JSONObject another=CloudProgressData.row(CloudProgressData.key("quark:other","high"),20000,90000);
        check(checks,CloudProgressData.clean(new JSONArray().put(base).put(another)).toString().equals(CloudProgressData.clean(new JSONArray().put(another).put(base)).toString()),"portable order is deterministic across input order");
        for(String fault:new String[]{"duplicate","bad-key","numeric-key","missing-position","fractional-position","string-position","negative-duration","null-row"}){
            JSONObject bad=Json.copy(base);JSONArray rows=new JSONArray().put(bad);
            switch(fault){case "duplicate":rows.put(base);break;case "bad-key":Json.put(bad,"key","https://example.invalid/token");break;case "numeric-key":Json.put(bad,"key",123);break;case "missing-position":bad.remove("position");break;case "fractional-position":Json.put(bad,"position",4.5);break;case "string-position":Json.put(bad,"position","40000");break;case "negative-duration":Json.put(bad,"duration",-1);break;default:rows=new JSONArray().put(JSONObject.NULL);}
            String before=rows.toString();boolean rejected=false;try{CloudProgressData.clean(rows);}catch(IllegalArgumentException expected){rejected=true;}check(checks,rejected&&before.equals(rows.toString()),"invalid cloud rows rejected without mutation: "+fault);
        }
        JSONArray tooMany=new JSONArray();for(int i=0;i<=CloudProgressData.MAX_ROWS;i++)tooMany.put(base);boolean rejected=false;try{CloudProgressData.clean(tooMany);}catch(IllegalArgumentException expected){rejected=true;}check(checks,rejected,"oversized portable cloud list rejected rather than truncated");
        Map<String,Object> old=new HashMap<>();old.put(hash+"-p",45555L);old.put(hash+"-d",90000L);old.put("private-note","do-not-copy");Map<String,Object> before=new HashMap<>(old);JSONArray migrated=CloudProgressData.legacy(old);
        check(checks,migrated.length()==1&&migrated.getJSONObject(0).getLong("position")==45555&&!migrated.toString().contains("do-not-copy")&&old.equals(before),"legacy conversion preserves values and original map while excluding unknown private keys");
        old.remove(hash+"-d");check(checks,CloudProgressData.legacy(old).getJSONObject(0).getLong("duration")==0,"legacy missing duration retains original zero-default semantics");
        old.remove(hash+"-p");old.put(hash+"-d",90000L);check(checks,CloudProgressData.legacy(old).getJSONObject(0).getLong("position")==0,"legacy missing position retains original zero-default semantics");
        old.put(hash+"-p","broken");before=new HashMap<>(old);rejected=false;try{CloudProgressData.legacy(old);}catch(IllegalArgumentException expected){rejected=true;}check(checks,rejected&&old.equals(before),"invalid legacy values fail without deleting or overwriting their source");
        return checks;
    }
    public static void main(String[] args)throws Exception{List<String> checks=run();for(String label:checks)System.out.println("PASS "+label);System.out.println("Passed "+checks.size()+" cloud progress checks");}
}
