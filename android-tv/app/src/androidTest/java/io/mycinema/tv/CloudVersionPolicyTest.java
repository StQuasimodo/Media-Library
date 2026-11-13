package io.mycinema.tv;

import java.util.*;
import org.json.*;

/** Shared host/API22 checks: service metadata is never presented as measured decode capability. */
public final class CloudVersionPolicyTest {
    private static void check(List<String> checks,boolean ok,String label){if(!ok)throw new AssertionError(label);checks.add(label);}
    private static JSONObject info(){return Json.object("{\"format\":\"m3u8\",\"width\":1920,\"height\":1080,\"codec\":\"h264\",\"fps\":23.976,\"bitrate\":3500000,\"success\":true,\"finish\":true,\"url\":\"https://cdn.example/movie.m3u8?token=never-display-secret\",\"audio\":{\"codec\":\"aac\",\"channels\":2}}");}
    private static JSONObject payload(JSONObject info){return wrap(info);}
    private static JSONObject wrap(JSONObject info){JSONObject row=new JSONObject(),data=new JSONObject(),root=new JSONObject();Json.put(row,"resolution","4k");Json.put(row,"video_info",info);Json.put(data,"video_list",new JSONArray().put(row));Json.put(root,"data",data);return root;}
    private static QuarkCloudVersions.Version version(JSONObject info){return QuarkCloudVersions.parse(payload(info)).get(0);}
    public static List<String> run() throws Exception {
        List<String> checks=new ArrayList<>();QuarkCloudVersions.Version base=version(info());
        check(checks,base.protocol.equals("HLS")&&base.codec.equals("h264")&&base.audioCodec.equals("aac")&&base.channels==2,"cloud response preserves reported protocol, video and audio metadata");
        check(checks,base.quality.equals("4k")&&base.width==1920&&base.height==1080,"quality tier does not overwrite reported pixel dimensions");
        check(checks,!base.details().contains("cdn.example")&&!base.details().contains("never-display-secret")&&!base.details().contains("token="),"cloud diagnostics discard signed URLs and tokens");
        check(checks,base.details().contains("尚未实际解码")&&base.details().contains("尚未开放"),"service metadata and availability are distinct from actual playback validation");
        JSONObject p=info();Json.put(p,"success",false);check(checks,version(p).state.equals("尚未就绪"),"failed transcode is not offered as ready despite a URL");
        p=info();Json.put(p,"finish",false);check(checks,version(p).state.equals("尚未就绪"),"unfinished transcode remains pending");
        p=payload(info());Json.put(p.getJSONObject("data").getJSONArray("video_list").getJSONObject(0),"accessable",false);check(checks,QuarkCloudVersions.parse(p).get(0).state.equals("当前账号不可用"),"account entitlement refusal remains visible");
        p=Json.object("{\"data\":{\"video_list\":[{\"resolution\":\"4k\",\"accessable\":false}]}}");check(checks,QuarkCloudVersions.parse(p).get(0).state.equals("当前账号不可用"),"restricted version without video_info remains visible");
        p=info();Json.put(p,"url",null);check(checks,version(p).state.equals("状态未知"),"missing URL does not imply ready playback");
        for(String bad:new String[]{"http://cdn.example/file.m3u8","https://user:secret@cdn.example/file.m3u8","file:///movie.mp4"}){p=info();Json.put(p,"url",bad);check(checks,version(p).state.equals("地址格式不支持"),"unsupported address rejected without fetching: "+bad.split(":")[0]);}
        p=info();Json.put(p,"format","fmp4_av");Json.put(p,"url","https://cdn.example/file.bin");check(checks,version(p).protocol.equals("fMP4"),"fragmented MP4 is not mislabeled as ordinary HLS or a proven playable file");
        p=info();Json.put(p,"width",-1);Json.put(p,"height",1080.5);Json.put(p,"fps",-24);Json.put(p,"bitrate",1e30);check(checks,version(p).width==0&&version(p).height==0&&version(p).fps==0&&version(p).bitrate==0,"invalid or excessive numeric fields remain unknown");
        p=info();Json.put(p,"codec","https://secret.example/token");Json.put(p,"format","unrecognized");Json.put(p,"url","https://cdn.example/file.bin");check(checks,version(p).codec.equals("未标注")&&version(p).protocol.equals("未知"),"unknown codecs and formats are not guessed from names");
        p=payload(info());JSONArray rows=p.getJSONObject("data").getJSONArray("video_list");rows.put(rows.getJSONObject(0));check(checks,QuarkCloudVersions.parse(p).size()==1,"identical public summaries are deduplicated");
        check(checks,QuarkCloudVersions.parse(Json.object("{\"data\":{\"video_list\":[]}}")).isEmpty(),"explicit empty version list differs from malformed response");
        boolean rejected=false;try{QuarkCloudVersions.parse(Json.object("{\"data\":{}}"));}catch(IllegalStateException expected){rejected=true;}check(checks,rejected,"missing list rejected as malformed, not treated as no available versions");
        p=payload(info());rows=p.getJSONObject("data").getJSONArray("video_list");for(int i=0;i<200;i++)rows.put(new JSONObject());rejected=false;try{QuarkCloudVersions.parse(p);}catch(IllegalStateException expected){rejected=true;}check(checks,rejected,"unbounded provider lists rejected");
        return checks;
    }
    public static void main(String[] args)throws Exception{List<String> checks=run();for(String label:checks)System.out.println("PASS "+label);System.out.println("Passed "+checks.size()+" cloud metadata checks");}
}
