package io.mycinema.tv;

import java.nio.charset.StandardCharsets;
import java.util.*;
import okhttp3.HttpUrl;

public final class HlsPlaylistPolicyTest {
    private static final HttpUrl BASE=HttpUrl.parse("https://video.quark.cn/folder/media.m3u8?Signature=old&Expires=123");
    private static HlsPlaylist.Parsed parse(String value)throws Exception{return HlsPlaylist.rewrite(value.getBytes(StandardCharsets.UTF_8),BASE,(n,u,p)->"http://127.0.0.1:1234/private/"+n+(p?".m3u8":".bin"));}
    private static void check(List<String> out,boolean value,String name){if(!value)throw new AssertionError(name);out.add(name);}
    private static boolean denied(String text){try{parse(text);return false;}catch(Exception expected){return true;}}
    public static List<String> run()throws Exception {
        List<String> checks=new ArrayList<>();String media="#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:4\n#EXT-X-MAP:URI=\"init.mp4?Signature=private&Expires=999\"\n#EXTINF:4,\nsegment.m4s?Signature=private&Expires=999\n#EXT-X-ENDLIST\n";
        HlsPlaylist.Parsed parsed=parse(media);String body=new String(parsed.body,StandardCharsets.UTF_8);
        check(checks,parsed.references.size()==2&&!body.contains("video.quark.cn")&&!body.contains("Signature")&&body.contains("127.0.0.1"),"fMP4 map and segments rewritten without leaking upstream addresses/signatures");
        check(checks,parsed.references.get(1).url.encodedPath().equals("/folder/segment.m4s"),"relative HLS reference uses actual playlist directory");
        String master="#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",NAME=\"English\",URI=\"audio.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO=\"a\"\nvideo.m3u8\n";
        parsed=parse(master);check(checks,parsed.references.size()==2&&parsed.references.get(0).playlist&&parsed.references.get(1).playlist,"master variant and alternate-audio playlist both stay in local graph");
        check(checks,parse(media.replace("private","fresh").replace("Expires=999","Expires=1000")).fingerprint.equals(parse(media).fingerprint),"signed expiry refresh does not change stable VOD fingerprint");
        check(checks,!parse(media.replace("segment.m4s","other.m4s")).fingerprint.equals(parse(media).fingerprint),"different segment identity changes fingerprint");
        check(checks,!parse(media.replace("#EXTINF:4,","#EXTINF:3,")).fingerprint.equals(parse(media).fingerprint),"timeline change rejects reuse after renewal");
        check(checks,!parse(media.replace("segment.m4s?","segment.m4s?asset=other&")).fingerprint.equals(parse(media).fingerprint),"non-signature query parameters remain part of media identity");
        for(String url:new String[]{"https://other.example/segment.m4s","http://video.quark.cn/segment.m4s","https://user:pass@video.quark.cn/segment.m4s","data:text/plain,segment","../media.m4s#fragment","{$secret}/segment.m4s"})check(checks,denied(media.replace("segment.m4s?Signature=private&Expires=999",url)),"unsafe or variable HLS reference rejected: "+url.split(":")[0]);
        check(checks,denied(media.replace("#EXT-X-ENDLIST\n","")),"live/open-ended media playlist not accepted as complete VOD");
        check(checks,denied(media.replace("#EXTM3U","#EXTM3U_BAD")),"non-HLS document rejected");
        check(checks,denied(media+"#EXT-X-PART:DURATION=1,URI=\"part.m4s\"\n"),"low-latency HLS rejected explicitly");
        check(checks,denied(media+"#EXT-X-SESSION-DATA:DATA-ID=\"x\",URI=\"data.json\"\n"),"unknown URI-bearing HLS tags fail closed");
        check(checks,denied(media.replace("#EXT-X-VERSION:7","#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"key.bin\"")),"unsupported SAMPLE-AES is not passed through");
        parsed=parse(media.replace("#EXT-X-VERSION:7","#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\""));check(checks,parsed.references.size()==3&&!new String(parsed.body,StandardCharsets.UTF_8).contains("key.bin"),"standard AES128 identity-key URI also becomes opaque local route");
        check(checks,denied(media.replace("#EXT-X-VERSION:7","#EXT-X-KEY:METHOD=AES-128,KEYFORMAT=\"drm.example\",URI=\"key.bin\"")),"non-identity key format rejected");
        check(checks,denied(media.replace("URI=\"init.mp4?Signature=private&Expires=999\"","URI=init.mp4")),"unquoted map URI rejected");
        check(checks,denied(media.replace("#EXT-X-VERSION:7","#COMMENT:https://private.example/token")),"unmapped external addresses cannot leak through comments");
        check(checks,denied(media.replace("#EXT-X-VERSION:7","#EXT-X-DEFINE:NAME=\"key\",VALUE=\"x\"")),"HLS variable definitions rejected");
        check(checks,parse(media.replace("\n","\r\n")).fingerprint.equals(parse(media).fingerprint),"newline convention does not create false media version change");
        StringBuilder many=new StringBuilder("#EXTM3U\n");for(int i=0;i<2001;i++)many.append("#EXTINF:1,\nseg").append(i).append(".ts\n");many.append("#EXT-X-ENDLIST\n");check(checks,denied(many.toString()),"manifest reference count is bounded");
        return checks;
    }
    public static void main(String[] args)throws Exception{List<String> checks=run();for(String name:checks)System.out.println("PASS "+name);System.out.println("Passed "+checks.size()+" HLS policy checks");}
}
