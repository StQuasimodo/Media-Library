package io.mycinema.tv;

import org.json.JSONObject;
import java.io.Closeable;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.SSLException;
import okhttp3.HttpUrl;
import okhttp3.Request;
import okhttp3.Response;

/** Streaming policy, independent of DAV directory handling and the decoder. */
final class MediaTransfer {
    interface Provider {
        MediaSources.Lease resolve(JSONObject file,NetworkScope scope) throws Exception;
        default MediaSources.Lease refresh(JSONObject file,MediaSources.Lease rejected,NetworkScope scope) throws Exception {return resolve(file,scope);}
    }
    static final long SEGMENT_BYTES=4L*1024*1024;
    private final Provider provider;
    private final StreamMetrics metrics = new StreamMetrics();
    private final LinkedHashMap<String,Slot> leases=new LinkedHashMap<>(8,0.75f,true);
    private final AtomicInteger recoveries=new AtomicInteger(),segments=new AtomicInteger();
    private volatile boolean closed;
    private volatile String lastError="";
    private static final class Slot {MediaSources.Lease lease;int users;volatile String error="";}
    private static final class ClientGone extends IOException {private static final long serialVersionUID=1L;}
    private static final class ReadAttempt {
        final StreamMetrics.Request timing;
        String stage = "准备媒体";
        int status;
        long forwarded;
        ReadAttempt(StreamMetrics.Request timing) { this.timing = timing; }

        String failure(Exception failure) {
            int apiCode = 0;
            int httpStatus = status;
            boolean compatibilityAddress = false;
            if (failure instanceof MediaSources.QuarkResponseException) {
                MediaSources.QuarkResponseException response = (MediaSources.QuarkResponseException) failure;
                httpStatus = response.httpStatus;
                apiCode = response.apiCode;
                compatibilityAddress = response.compatibilityAddress;
            }
            StringBuilder message = new StringBuilder("媒体读取失败（").append(stage);
            if (compatibilityAddress) message.append("，兼容接口");
            if (httpStatus > 0) message.append(" · HTTP ").append(httpStatus);
            if (apiCode != 0) message.append(" · 夸克代码 ").append(apiCode);
            if (failure instanceof SocketTimeoutException) message.append(" · 网络超时");
            else if (failure instanceof UnknownHostException) message.append(" · 域名解析失败");
            else if (failure instanceof SSLException) message.append(" · HTTPS连接失败");
            return message.append(" · 已转发 ").append(forwarded).append(" 字节）").toString();
        }
    }
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
            if(slot.lease==null||slot.lease==rejected||slot.lease.expired()){
                MediaSources.Lease fresh=slot.lease==null?provider.resolve(file,scope):provider.refresh(file,slot.lease,scope);
                scope.check();if(closed)throw new IOException("Transport stopped");slot.lease=fresh;
            }
            return slot.lease;
        }}finally{synchronized(this){slot.users--;trim();}}
    }
    String error(){return lastError;}
    synchronized String error(JSONObject file){Slot slot=leases.get(key(file));return slot==null?"":slot.error;}
    int recoveries(){return recoveries.get();}
    int segments(){return segments.get();}
    StreamMetrics metrics(){return metrics;}
    synchronized void close(){closed=true;leases.clear();}
    private synchronized void error(JSONObject file,String text){if(closed)return;slot(file).error=text;lastError=text;trim();}

    private NetworkScope.Exchange request(MediaSources.Lease lease,String range,boolean head,NetworkScope scope,boolean originalQuark,ReadAttempt attempt) throws Exception {
        HttpUrl url=lease.url;
        for(int redirects=0;redirects<=4;redirects++){
            scope.check();Request.Builder request=new Request.Builder().url(url).method(head?"HEAD":"GET",null).header("Accept-Encoding","identity");
            if(MediaSources.sameOrigin(url,lease.url))for(Map.Entry<String,String> header:lease.requestHeaders().entrySet())request.header(header.getKey(),header.getValue());
            else if(originalQuark&&url.isHttps()){
                // A signed CDN redirect still needs the public client headers.
                // Never forward Cookie or Authorization across origins.
                String userAgent=lease.headers.get("User-Agent");
                request.header("User-Agent",userAgent==null?MediaSources.UA:userAgent).header("Referer","https://pan.quark.cn/");
            }
            if(!range.isEmpty())request.header("Range",range);
            attempt.status=0;
            NetworkScope.Exchange exchange;
            attempt.timing.begin(StreamMetrics.Step.RESPONSE);
            try{exchange=scope.open(MediaSources.HTTP,request.build());}finally{attempt.timing.finish(0);}
            Response response=exchange.response;
            attempt.status=response.code();
            if(response.code()<300||response.code()>=400)return exchange;
            String location=response.header("Location");HttpUrl next=location==null?null:url.resolve(location);exchange.close();
            if(next==null||lease.sameOriginOnly&&!MediaSources.sameOrigin(lease.url,next)||(lease.url.isHttps()&&!next.isHttps())||!next.username().isEmpty()||!next.password().isEmpty())throw new IOException("Invalid media redirect");url=next;
        }
        throw new IOException("Too many media redirects");
    }
    private NetworkScope.Exchange open(JSONObject file,String range,boolean head,NetworkScope scope,ReadAttempt attempt,String requestStage) throws Exception {
        boolean quark=Json.text(file,"source").equals("quark");
        boolean originalQuark=quark&&!file.optBoolean("_cloudHls");
        attempt.stage="获取媒体地址";attempt.status=0;
        MediaSources.Lease current=timedLease(file,null,scope,attempt);
        attempt.stage=requestStage;
        NetworkScope.Exchange exchange=request(current,range,head,scope,originalQuark,attempt);
        if((exchange.response.code()==401||exchange.response.code()==403)&&quark){
            exchange.close();
            attempt.timing.retry();
            attempt.stage="刷新媒体地址";
            attempt.status=0;
            MediaSources.Lease refreshed=timedLease(file,current,scope,attempt);
            attempt.stage=requestStage;
            exchange=request(refreshed,range,head,scope,originalQuark,attempt);
        }
        return exchange;
    }
    private MediaSources.Lease timedLease(JSONObject file,MediaSources.Lease rejected,NetworkScope scope,ReadAttempt attempt) throws Exception {
        attempt.timing.begin(StreamMetrics.Step.ADDRESS);
        try{return lease(file,rejected,scope);}finally{attempt.timing.finish(0);}
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

    // A single foreground stream may overlap up to four header waits. Bodies stay
    // on their sockets until consumed in order, under the same 64 KiB copy loop.
    private static final Semaphore lookaheadSlot = new Semaphore(1);

    private final class RangeWindow implements Closeable {
        private final ArrayDeque<Future<NetworkScope.Exchange>> pending = new ArrayDeque<>();
        private final NetworkScope calls = new NetworkScope();
        private final java.util.Set<NetworkScope.Exchange> unclaimed = new java.util.HashSet<>();
        final Closeable cancellation = this::cancel;
        private final ExecutorService workers = Executors.newFixedThreadPool(4);
        private final JSONObject file;
        private final StreamMetrics metrics;
        private final long last;
        private long next;
        private boolean closedWindow;

        RangeWindow(JSONObject file, StreamMetrics metrics, long next, long last) {
            this.file = file;
            this.metrics = metrics;
            this.next = next;
            this.last = last;
        }

        synchronized void fill() {
            while (!closedWindow && pending.size() < 4 && next <= last) {
                long start = next;
                long end = segmentEnd(start, last);
                next = end + 1;
                pending.add(workers.submit(() -> {
                    try (StreamMetrics.Request timing = metrics.open()) {
                        NetworkScope.Exchange exchange = open(file, bytes(start, end), false, calls,
                            new ReadAttempt(timing), "请求后续视频");
                        synchronized (this) {
                            if (!closedWindow) {
                                unclaimed.add(exchange);
                                return exchange;
                            }
                        }
                        exchange.close();
                        throw new IOException("Range cancelled");
                    }
                }));
            }
        }

        NetworkScope.Exchange take() throws Exception {
            Future<NetworkScope.Exchange> first;
            synchronized (this) {
                calls.check();
                first = pending.element();
            }
            NetworkScope.Exchange exchange = first.get();
            synchronized (this) {
                pending.remove();
                unclaimed.remove(exchange);
            }
            return exchange;
        }

        // Session revocation can run on the Activity thread. Cancel calls here,
        // but close unread response bodies on the serving thread (OkHttp may drain).
        private synchronized void cancel() {
            if (closedWindow) return;
            closedWindow = true;
            calls.close();
            for (Future<?> future : pending) future.cancel(true);
            workers.shutdownNow();
        }

        @Override public void close() {
            cancel();
            try {
                synchronized (this) {
                    for (NetworkScope.Exchange exchange : unclaimed) exchange.close();
                    unclaimed.clear();
                }
            } finally {
                lookaheadSlot.release();
            }
        }
    }

    void serve(JSONObject file,String header,boolean head,OutputStream output,NetworkScope scope) throws IOException {
        serve(file,header,head,output,scope,metrics,false);
    }
    void serve(JSONObject file,String header,boolean head,OutputStream output,NetworkScope scope,StreamMetrics metrics,boolean playbackVideo) throws IOException {
        RangeWindow window=null;
        ReadAttempt attempt=new ReadAttempt(metrics.open());
        boolean started=false;NetworkScope.Exchange current=null;InputStream prefetched=null;
        try{
            Range range;try{range=header.isEmpty()?null:new Range(header);}catch(IllegalArgumentException invalid){headers(output,416,0,"",null);return;}
            boolean quark=Json.text(file,"source").equals("quark");
            if(head){
                current=open(file,quark?"bytes=0-0":"",!quark,scope,attempt,"探测文件大小");
                if(!quark&&(current.response.code()==405||current.response.code()==501)){current.close();current=open(file,"bytes=0-0",false,scope,attempt,"探测文件大小");}
                Shape shape=new Shape(current.response);if(shape.total<0)throw new IOException("Unknown media length");
                started=true;headers(output,200,shape.total,"",current.response);return;
            }
            long from=range==null?0:range.start,desiredEnd=range==null?Long.MAX_VALUE:range.end;
            if(range!=null&&range.suffix>0){
                current=open(file,"bytes=0-0",false,scope,attempt,"探测尾段位置");Shape probe=new Shape(current.response);if(probe.total<=0)throw new IOException("Unknown suffix position");from=range.start(probe.total);desiredEnd=range.end(probe.total);current.close();current=null;
            }
            long firstEnd=quark?segmentEnd(from,desiredEnd):desiredEnd;
            String upstreamRange=quark?bytes(from,firstEnd):header;
            current=open(file,upstreamRange,false,scope,attempt,"请求首段视频");Response response=current.response;
            if(response.code()==416){String value=response.header("Content-Range","");if(!value.matches("bytes \\*/\\d+"))value="";started=true;headers(output,416,0,value,null);return;}
            if(file.optBoolean("_cloudHls")){
                String type=response.header("Content-Type","").split(";")[0].trim().toLowerCase(java.util.Locale.ROOT);
                if(!type.isEmpty()&&!java.util.Arrays.asList("video/mp4","audio/mp4","application/mp4","video/mp2t","audio/aac","audio/mpeg","application/octet-stream","binary/octet-stream","video/iso.segment","text/vtt").contains(type))throw new IOException("Unsupported HLS resource type");
            }
            if(response.isSuccessful())attempt.stage="校验首段响应";
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
            if(file.optBoolean("_cloudHls")&&from==0){
                java.io.PushbackInputStream peek=new java.io.PushbackInputStream(response.body().byteStream(),32);byte[] prefix=new byte[32];int count=0,limit=(int)Math.min(32,shape.end>=0?shape.end+1:32);
                attempt.timing.begin(StreamMetrics.Step.READ);
                try{while(count<limit){int n=peek.read(prefix,count,limit-count);if(n<0)break;count+=n;}}
                finally{attempt.timing.finish(0);}
                String magic=new String(prefix,0,count,java.nio.charset.StandardCharsets.UTF_8).replace("\ufeff","").trim();
                if(magic.startsWith("#EXTM3U")||magic.startsWith("<html")||magic.startsWith("<!DOCTYPE")||magic.startsWith("<?xml"))throw new IOException("Playlist or error document disguised as HLS media");
                peek.unread(prefix,0,count);prefetched=peek;
            }
            error(file,"");started=true;headers(output,code,length,code==206?"bytes "+from+"-"+end+"/"+shape.total:"",response);
            byte[] buffer=new byte[65536];long offset=from,partEnd=shape.end;int retries=0;
            if(playbackVideo && quark && response.code()==206 && end-partEnd>=SEGMENT_BYTES
                    && lookaheadSlot.tryAcquire()){
                window=new RangeWindow(file,metrics,partEnd+1,end);
                scope.own(window.cancellation);
            }
            while(!scope.cancelled()){
                if(window!=null)window.fill();
                attempt.stage="读取视频数据";
                InputStream input=prefetched==null?current.response.body().byteStream():prefetched;prefetched=null;boolean dropped=false;
                while(!scope.cancelled()){
                    int limit=partEnd>=0?(int)Math.min(buffer.length,partEnd-offset+1):buffer.length;if(limit==0)break;
                    int count;try{
                        count=read(input,buffer,0,limit,attempt);
                        if(count<0&&partEnd>=0&&offset<=partEnd)throw new IOException("Media ended early");
                    }
                    catch(IOException failure){if(!quark||shape.total<=0||retries>=2)throw failure;dropped=true;break;}
                    if(count<0)return;
                    int written=0;
                    attempt.timing.begin(StreamMetrics.Step.WRITE);
                    try{write(output,buffer,count);written=count;}finally{attempt.timing.finish(written);}
                    offset+=count;attempt.forwarded+=count;
                }
                scope.check();if(end>=0&&offset>end)return;if(partEnd<0)return;
                current.close();current=null;
                if(dropped){retries++;attempt.timing.retry();}else{partEnd=quark?segmentEnd(offset,end):end;}
                if(window!=null && !dropped){
                    try{
                        current=window.take();
                        attempt.status=current.response.code();
                        if(!current.response.isSuccessful()){
                            current.close();
                            current=null;
                        }
                    }catch(java.util.concurrent.ExecutionException failed){
                        // Retry this exact offset through the serial path.
                    }
                    if(current==null){
                        window.close();
                        scope.disown(window.cancellation);
                        window=null;
                        attempt.timing.retry();
                    }
                }
                if(current==null)current=open(file,bytes(offset,partEnd),false,scope,attempt,dropped?"续接视频":"请求后续视频");
                if(current.response.isSuccessful())attempt.stage=dropped?"校验续接响应":"校验后续分段";
                shape.verify(current.response,offset,partEnd);
                if(dropped)recoveries.incrementAndGet();else segments.incrementAndGet();
            }
        }catch(ClientGone ignored){/* Seeking/stopping is normal, not a source failure. */}
        catch(Exception failure){if(!scope.cancelled()){error(file,attempt.failure(failure));if(!started)headers(output,502,0,"",null);}}
        finally{if(current!=null)current.close();if(window!=null){window.close();scope.disown(window.cancellation);}attempt.timing.close();}
    }
    private static int read(InputStream input,byte[] buffer,int from,int length,ReadAttempt attempt) throws IOException {
        int count=0;
        attempt.timing.begin(StreamMetrics.Step.READ);
        try{count=input.read(buffer,from,length);return count;}finally{attempt.timing.finish(Math.max(count,0));}
    }
}
