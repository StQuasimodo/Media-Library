package io.mycinema.tv;

import org.json.JSONObject;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import okhttp3.HttpUrl;
import okhttp3.Request;
import okhttp3.Response;

/** Streaming policy, independent of DAV directory handling and the decoder. */
final class MediaTransfer {
    interface Provider {MediaSources.Lease resolve(JSONObject file,NetworkScope scope) throws Exception;}
    static final long SEGMENT_BYTES=4L*1024*1024;
    private final Provider provider;
    private final LinkedHashMap<String,Slot> leases=new LinkedHashMap<>(8,0.75f,true);
    private final AtomicInteger recoveries=new AtomicInteger(),segments=new AtomicInteger();
    private volatile boolean closed;
    private volatile String lastError="";
    private static final class Slot {MediaSources.Lease lease;int users;volatile String error="";}
    private static final class ClientGone extends IOException {private static final long serialVersionUID=1L;}
    MediaTransfer(Provider provider){this.provider=provider;}
    private static String key(JSONObject file){return Json.text(file,"source")+":"+Json.text(file,"fileId");}
    private Slot slot(JSONObject file){String key=key(file);Slot slot=leases.get(key);if(slot==null){slot=new Slot();leases.put(key,slot);}return slot;}
    private void trim(){
        java.util.Iterator<Slot> entries=leases.values().iterator();while(leases.size()>8&&entries.hasNext())if(entries.next().users==0)entries.remove();
    }
    private MediaSources.Lease lease(JSONObject file,MediaSources.Lease rejected,NetworkScope scope) throws Exception {
        Slot slot;synchronized(this){scope.check();if(closed)throw new IOException("Transport stopped");slot=slot(file);slot.users++;trim();}
        // Resolve under a per-file lock, never while holding the whole cache lock.
        // A concurrent 403 for the same rejected lease reuses an already-refreshed address.
        try{synchronized(slot){scope.check();if(closed)throw new IOException("Transport stopped");
            if(slot.lease==null||slot.lease==rejected){MediaSources.Lease fresh=provider.resolve(file,scope);scope.check();if(closed)throw new IOException("Transport stopped");slot.lease=fresh;}
            return slot.lease;
        }}finally{synchronized(this){slot.users--;trim();}}
    }
    String error(){return lastError;}
    synchronized String error(JSONObject file){Slot slot=leases.get(key(file));return slot==null?"":slot.error;}
    int recoveries(){return recoveries.get();}
    int segments(){return segments.get();}
    synchronized void close(){closed=true;leases.clear();}
    private synchronized void error(JSONObject file,String text){if(closed)return;slot(file).error=text;lastError=text;trim();}

    private NetworkScope.Exchange request(MediaSources.Lease lease,String range,boolean head,NetworkScope scope) throws Exception {
        HttpUrl url=lease.url;
        for(int redirects=0;redirects<=4;redirects++){
            scope.check();Request.Builder request=new Request.Builder().url(url).method(head?"HEAD":"GET",null).header("Accept-Encoding","identity");
            if(MediaSources.sameOrigin(url,lease.url))for(Map.Entry<String,String> header:lease.requestHeaders().entrySet())request.header(header.getKey(),header.getValue());
            if(!range.isEmpty())request.header("Range",range);
            NetworkScope.Exchange exchange=scope.open(MediaSources.HTTP,request.build());Response response=exchange.response;
            if(response.code()<300||response.code()>=400)return exchange;
            String location=response.header("Location");HttpUrl next=location==null?null:url.resolve(location);exchange.close();
            if(next==null||(lease.url.isHttps()&&!next.isHttps())||!next.username().isEmpty()||!next.password().isEmpty())throw new IOException("Invalid media redirect");url=next;
        }
        throw new IOException("Too many media redirects");
    }
    private NetworkScope.Exchange open(JSONObject file,String range,boolean head,NetworkScope scope) throws Exception {
        MediaSources.Lease current=lease(file,null,scope);NetworkScope.Exchange exchange=request(current,range,head,scope);
        if((exchange.response.code()==401||exchange.response.code()==403)&&Json.text(file,"source").equals("quark")){
            exchange.close();exchange=request(lease(file,current,scope),range,head,scope);
        }
        return exchange;
    }
    private static final class Range {
        final long start,end,suffix;
        Range(String header){
            if(!header.matches("bytes=\\d*-\\d*")||header.equals("bytes=-"))throw new IllegalArgumentException();String[] parts=header.substring(6).split("-",-1);
            start=parts[0].isEmpty()?0:Long.parseLong(parts[0]);end=parts[1].isEmpty()?Long.MAX_VALUE:Long.parseLong(parts[1]);suffix=parts[0].isEmpty()?end:0;
            if(suffix==0&&parts[0].isEmpty()||suffix==0&&end<start)throw new IllegalArgumentException();
        }
        long start(long total){return suffix>0?Math.max(0,total-suffix):start;}
        long end(long total){return suffix>0?total-1:Math.min(end,total-1);}
    }
    private static final class Shape {
        final long start,end,total;final String validator,validatorHeader;
        Shape(Response response) throws IOException {
            long first=0,last=-1,size=-1;
            try{
                if(response.code()==206){Matcher match=Pattern.compile("bytes (\\d+)-(\\d+)/(\\d+)").matcher(response.header("Content-Range",""));if(!match.matches())throw new IOException("Missing exact range");first=Long.parseLong(match.group(1));last=Long.parseLong(match.group(2));size=Long.parseLong(match.group(3));if(first>last||last>=size)throw new IOException("Invalid media range");}
                else if(response.code()==200){size=Long.parseLong(response.header("Content-Length","-1"));last=size-1;}
                else throw new IOException("Media unavailable");
                String length=response.header("Content-Length");if(length!=null&&last>=first&&Long.parseLong(length)!=last-first+1)throw new IOException("Invalid media length");
            }catch(NumberFormatException invalid){throw new IOException("Invalid media length");}
            if(!response.header("Content-Encoding","identity").equalsIgnoreCase("identity"))throw new IOException("Encoded media cannot be joined");
            start=first;end=last;total=size;String etag=response.header("ETag","");validatorHeader=etag.isEmpty()||etag.startsWith("W/")?"Last-Modified":"ETag";validator=response.header(validatorHeader,"");
        }
        void verify(Response response,long from,long to) throws IOException {
            Shape next=new Shape(response);
            if(response.code()!=206||next.start!=from||next.end!=to||next.total!=total||!validator.isEmpty()&&!validator.equals(response.header(validatorHeader)))throw new IOException("Media changed or range refused");
        }
    }
    private static long segmentEnd(long start,long end){return Math.min(end,start>Long.MAX_VALUE-SEGMENT_BYTES?Long.MAX_VALUE:start+SEGMENT_BYTES-1);}
    private static String bytes(long start,long end){return "bytes="+start+"-"+end;}
    private static void write(OutputStream output,byte[] bytes,int length) throws ClientGone {try{output.write(bytes,0,length);}catch(IOException gone){throw new ClientGone();}}
    private static void headers(OutputStream output,int code,long length,String range,Response source) throws IOException {
        StringBuilder headers=new StringBuilder("HTTP/1.1 "+code+" Media\r\nConnection: close\r\n");
        if(length>=0)headers.append("Content-Length: ").append(length).append("\r\n");
        if(!range.isEmpty())headers.append("Content-Range: ").append(range).append("\r\n");
        for(String name:new String[]{"Content-Type","Accept-Ranges","ETag","Last-Modified"}){String value=source==null?null:source.header(name);if(value!=null&&!value.contains("\r")&&!value.contains("\n"))headers.append(name).append(": ").append(value).append("\r\n");}
        if(source!=null&&source.code()==206&&source.header("Accept-Ranges")==null)headers.append("Accept-Ranges: bytes\r\n");
        byte[] encoded=headers.append("\r\n").toString().getBytes(StandardCharsets.US_ASCII);write(output,encoded,encoded.length);
    }

    void serve(JSONObject file,String header,boolean head,OutputStream output,NetworkScope scope) throws IOException {
        boolean started=false;NetworkScope.Exchange current=null;
        try{
            Range range;try{range=header.isEmpty()?null:new Range(header);}catch(IllegalArgumentException invalid){headers(output,416,0,"",null);return;}
            boolean quark=Json.text(file,"source").equals("quark");
            if(head){
                current=open(file,quark?"bytes=0-0":"",!quark,scope);
                if(!quark&&(current.response.code()==405||current.response.code()==501)){current.close();current=open(file,"bytes=0-0",false,scope);}
                Shape shape=new Shape(current.response);if(shape.total<0)throw new IOException("Unknown media length");
                started=true;headers(output,200,shape.total,"",current.response);return;
            }
            long from=range==null?0:range.start,desiredEnd=range==null?Long.MAX_VALUE:range.end;
            if(range!=null&&range.suffix>0){
                current=open(file,"bytes=0-0",false,scope);Shape probe=new Shape(current.response);if(probe.total<=0)throw new IOException("Unknown suffix position");from=range.start(probe.total);desiredEnd=range.end(probe.total);current.close();current=null;
            }
            long firstEnd=quark?segmentEnd(from,desiredEnd):desiredEnd;
            String upstreamRange=quark?bytes(from,firstEnd):header;
            current=open(file,upstreamRange,false,scope);Response response=current.response;
            if(response.code()==416){String value=response.header("Content-Range","");if(!value.matches("bytes \\*/\\d+"))value="";started=true;headers(output,416,0,value,null);return;}
            Shape shape=new Shape(response);long end;
            if(response.code()==206){
                long expectedEnd=Math.min(firstEnd,shape.total-1);if(!quark&&range==null)expectedEnd=shape.total-1;
                if(shape.start!=from||shape.end!=expectedEnd)throw new IOException("Initial response has wrong byte range");
                end=range==null?shape.total-1:range.end(shape.total);
            }else{
                if(from!=0||range!=null&&range.end!=Long.MAX_VALUE)throw new IOException("Upstream does not support seeking");
                end=shape.end;
            }
            long length=end>=from?end-from+1:-1;int code=range!=null&&response.code()==206?206:200;
            error(file,"");started=true;headers(output,code,length,code==206?"bytes "+from+"-"+end+"/"+shape.total:"",response);
            byte[] buffer=new byte[65536];long offset=from,partEnd=shape.end;int retries=0;
            while(!scope.cancelled()){
                InputStream input=current.response.body().byteStream();boolean dropped=false;
                while(!scope.cancelled()){
                    int limit=partEnd>=0?(int)Math.min(buffer.length,partEnd-offset+1):buffer.length;if(limit==0)break;
                    int count;try{count=input.read(buffer,0,limit);if(count<0&&partEnd>=0&&offset<=partEnd)throw new IOException("Media ended early");}
                    catch(IOException failure){if(!quark||shape.total<=0||retries>=2)throw failure;dropped=true;break;}
                    if(count<0)return;write(output,buffer,count);offset+=count;
                }
                scope.check();if(end>=0&&offset>end)return;if(partEnd<0)return;
                current.close();current=null;
                if(dropped){retries++;}else{partEnd=quark?segmentEnd(offset,end):end;}
                current=open(file,bytes(offset,partEnd),false,scope);shape.verify(current.response,offset,partEnd);
                if(dropped)recoveries.incrementAndGet();else segments.incrementAndGet();
            }
        }catch(ClientGone ignored){/* Seeking/stopping is normal, not a source failure. */}
        catch(Exception failure){if(!scope.cancelled()){error(file,"媒体读取未完成，请检查网络或登录状态后重新连接。");if(!started)headers(output,502,0,"",null);}}
        finally{if(current!=null)current.close();}
    }
}
