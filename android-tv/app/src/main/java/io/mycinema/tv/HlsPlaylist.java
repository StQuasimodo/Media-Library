package io.mycinema.tv;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.*;
import okhttp3.HttpUrl;

/** Bounded static-HLS parser. Every URI is resolved through an explicit local route. */
final class HlsPlaylist {
    interface Routes {String route(int index,HttpUrl url,boolean playlist) throws IOException;}
    static final class Reference {final HttpUrl url;final boolean playlist;Reference(HttpUrl url,boolean playlist){this.url=url;this.playlist=playlist;}}
    static final class Parsed {final byte[] body;final String fingerprint;final List<Reference> references;Parsed(byte[] body,String fingerprint,List<Reference> references){this.body=body;this.fingerprint=fingerprint;this.references=references;}}
    private static final Pattern URI=Pattern.compile("\\bURI=\"([^\"]*)\"");
    private static final Set<String> VOLATILE=new HashSet<>(Arrays.asList("expires","signature","ossaccesskeyid","x-oss-signature","x-oss-date","x-oss-expires"));
    static HttpUrl child(HttpUrl base,String value)throws IOException {
        if(value.isEmpty()||value.length()>8192||value.contains("\\")||value.indexOf('\r')>=0||value.indexOf('\n')>=0||value.contains("{$"))throw new IOException("Unsupported HLS reference");
        HttpUrl url=base.resolve(value);
        if(url==null||!url.isHttps()||!(base.scheme().equals(url.scheme())&&base.host().equals(url.host())&&base.port()==url.port())||!url.username().isEmpty()||!url.password().isEmpty()||url.fragment()!=null)throw new IOException("HLS reference leaves the selected origin");
        return url;
    }
    static String identity(HttpUrl url){
        HttpUrl.Builder clean=url.newBuilder().query(null);List<String> pairs=new ArrayList<>();
        for(int i=0;i<url.querySize();i++)if(!VOLATILE.contains(url.queryParameterName(i).toLowerCase(Locale.ROOT)))pairs.add(url.queryParameterName(i).length()+":"+url.queryParameterName(i)+":"+(url.queryParameterValue(i)==null?"-":url.queryParameterValue(i).length()+":"+url.queryParameterValue(i)));
        Collections.sort(pairs);return clean.build().toString()+"|"+pairs.toString();
    }
    static Parsed rewrite(byte[] bytes,HttpUrl base,Routes routes)throws IOException {
        if(bytes.length>262144)throw new IOException("HLS playlist too large");
        String text=new String(bytes,StandardCharsets.UTF_8);if(text.startsWith("\ufeff"))text=text.substring(1);
        if(!(text.startsWith("#EXTM3U\n")||text.startsWith("#EXTM3U\r\n")||text.equals("#EXTM3U"))||text.indexOf('\0')>=0)throw new IOException("Expected HLS playlist");
        List<Reference> refs=new ArrayList<>();StringBuilder out=new StringBuilder(),shape=new StringBuilder();boolean master=false,nextPlaylist=false,media=false,end=false;
        for(String raw:text.split("\r?\n",-1)){
            String line=raw.trim();if(line.length()>16384)throw new IOException("HLS line too long");
            if(line.startsWith("#EXT-X-DEFINE")||line.startsWith("#EXT-X-PART")||line.startsWith("#EXT-X-PRELOAD-HINT")||line.startsWith("#EXT-X-SKIP")||line.startsWith("#EXT-X-SERVER-CONTROL")||line.startsWith("#EXT-X-RENDITION-REPORT"))throw new IOException("Live or variable HLS is not supported");
            if(line.equals("#EXT-X-ENDLIST"))end=true;
            if(line.startsWith("#EXT-X-STREAM-INF:")){master=true;nextPlaylist=true;}
            boolean attrPlaylist=line.startsWith("#EXT-X-MEDIA:")||line.startsWith("#EXT-X-I-FRAME-STREAM-INF:");
            boolean key=line.startsWith("#EXT-X-KEY:")||line.startsWith("#EXT-X-SESSION-KEY:");boolean map=line.startsWith("#EXT-X-MAP:");
            if(key&&(!line.matches(".*(?:[:,])METHOD=(?:AES-128|NONE)(?:,.*)?$")||line.contains("KEYFORMAT=")&&!line.contains("KEYFORMAT=\"identity\"")))throw new IOException("Unsupported encrypted HLS");
            if(!line.isEmpty()&&!line.startsWith("#")){
                boolean playlist=nextPlaylist;nextPlaylist=false;if(!playlist)media=true;
                HttpUrl url=child(base,line);int index=refs.size();refs.add(new Reference(url,playlist));
                out.append(routes.route(index,url,playlist)).append('\n');shape.append(playlist?'P':'B').append(identity(url)).append('\n');
            }else if(line.contains("URI=")){
                if(!attrPlaylist&&!key&&!map)throw new IOException("Unknown HLS URI attribute");
                Matcher match=URI.matcher(line);StringBuffer local=new StringBuffer(),stable=new StringBuffer();int last=0,count=0;
                while(match.find()){
                    HttpUrl url=child(base,match.group(1));int index=refs.size();refs.add(new Reference(url,attrPlaylist));
                    match.appendReplacement(local,Matcher.quoteReplacement("URI=\""+routes.route(index,url,attrPlaylist)+"\""));
                    stable.append(line,last,match.start()).append("URI=\"").append(identity(url)).append('"');last=match.end();count++;
                }
                if(count==0)throw new IOException("Invalid HLS URI attribute");match.appendTail(local);stable.append(line.substring(last));
                if(URI.matcher(line).replaceAll("URI=\"\"").contains("://"))throw new IOException("Unmapped HLS URI");
                out.append(local).append('\n');shape.append(stable).append('\n');
            }else{
                if(line.contains("://")||line.contains("{$"))throw new IOException("Unmapped HLS metadata");out.append(line).append('\n');shape.append(line).append('\n');
            }
            if(refs.size()>2000)throw new IOException("HLS reference limit exceeded");
        }
        if(nextPlaylist||master&&media||media&&!end||!master&&!media)throw new IOException("Only complete static HLS is supported");
        try{byte[] digest=MessageDigest.getInstance("SHA-256").digest(shape.toString().getBytes(StandardCharsets.UTF_8));StringBuilder hash=new StringBuilder();for(byte b:digest)hash.append(String.format(Locale.ROOT,"%02x",b&255));return new Parsed(out.toString().getBytes(StandardCharsets.UTF_8),hash.toString(),refs);}catch(java.security.GeneralSecurityException impossible){throw new IOException("HLS fingerprint unavailable");}
    }
}
