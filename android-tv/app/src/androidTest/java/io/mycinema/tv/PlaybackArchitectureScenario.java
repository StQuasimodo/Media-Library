package io.mycinema.tv;

import android.content.Context;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import okhttp3.HttpUrl;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONObject;

/** Protocol edge cases and cancellation use the real app server, not a replacement gateway. */
final class PlaybackArchitectureScenario {
    private final Context context;
    PlaybackArchitectureScenario(Context context){this.context=context;}
    private void check(boolean value,String text){if(!value)throw new AssertionError(text);}
    private JSONObject control(String fault) throws Exception {
        try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url("http://10.0.2.2:8765/"+(fault==null?"":"control?fault="+fault)).build()).execute()){check(response.code()==200,"fixture control");return Json.object(response.body().string());}
    }
    private Response get(MediaSources.Lease endpoint,String range) throws Exception {
        Request.Builder request=new Request.Builder().url(endpoint.url).header("Authorization",endpoint.headers.get("Authorization"));if(range!=null)request.header("Range",range);return MediaSources.HTTP.newCall(request.build()).execute();
    }
    private byte[] reference(long start,long end) throws Exception {
        try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url("https://drive-pc.quark.cn/stream/movie.mp4").header("Cookie","__puus=tv-playback-fixture").header("Range","bytes="+start+"-"+end).build()).execute()){check(response.code()==206,"reference range");return response.body().bytes();}
    }
    void run(MediaSources.Lease file,MediaSources.Entry entry,JSONObject report) throws Exception {
        control("none");long start=1000,end=start+5L*1024*1024+63;byte[] baseline=reference(start,end);
        control("bounded_only");
        try(Response response=get(file,"bytes="+start+"-"+end)){check(response.code()==206&&Arrays.equals(baseline,response.body().bytes()),"multi-segment response is byte-exact across four-MiB boundary");}
        long size;try(Response response=MediaSources.HTTP.newCall(new Request.Builder().url(file.url).header("Authorization",file.headers.get("Authorization")).head().build()).execute()){check(response.code()==200&&response.body().bytes().length==0,"HEAD works although upstream rejects HEAD");size=Long.parseLong(response.header("Content-Length"));}
        byte[] tail;try(Response response=get(file,"bytes=-64")){check(response.code()==206&&response.header("Content-Range").equals("bytes "+(size-64)+"-"+(size-1)+"/"+size),"suffix means file tail");tail=response.body().bytes();}
        JSONObject state=control(null);check(state.optInt("quarkGets")>=4&&state.optInt("unboundedQuarkGets")==0&&state.optLong("maxQuarkRangeBytes")==4L*1024*1024,"cloud requests are bounded and no segment exceeds fourMiB");
        Json.put(report,"boundedSegmentBytes",4L*1024*1024);Json.put(report,"boundedMultiSegmentByteExact",true);Json.put(report,"headWithoutUpstreamHead",true);
        control("none");check(Arrays.equals(tail,reference(size-64,size-1)),"suffix body matches actual tail");Json.put(report,"suffixRangeByteExact",true);
        control("wrong_initial");try(Response response=get(file,"bytes=1000-1063")){check(response.code()==502&&response.body().bytes().length==0,"wrong initial Content-Range is rejected before video headers");}control("none");Json.put(report,"wrongInitialRangeRejected",true);

        // Both old URLs must really return403; a barrier in the upstream makes the race reproducible.
        ExecutorService pair=Executors.newFixedThreadPool(2);
        try{
            int downloads=control("expire_concurrent").optInt("downloads");
            Future<byte[]> a=pair.submit(()->{try(Response response=get(file,"bytes=1000-1063")){check(response.code()==206,"concurrent range a");return response.body().bytes();}});
            Future<byte[]> b=pair.submit(()->{try(Response response=get(file,"bytes=1000-1063")){check(response.code()==206,"concurrent range b");return response.body().bytes();}});
            byte[] aa=a.get(15,TimeUnit.SECONDS),bb=b.get(15,TimeUnit.SECONDS);state=control(null);
            check(state.optInt("expiredReplies")==2&&state.optInt("downloads")==downloads+1&&aa.length==64&&Arrays.equals(aa,bb),"simultaneous403s renew the rejected lease once");Json.put(report,"concurrentExpirySingleRefresh",true);
        }finally{pair.shutdownNow();control("none");}

        // Use a fresh transport to force its lease API call to block, then stop the real server.
        MediaSources backend=new MediaSources(context);QuarkDavTree tree=new QuarkDavTree("tv-root","取消验证",(id,scope)->backend.withScope(scope).rawQuarkList(id));
        PlaybackRelay server=new PlaybackRelay(backend,tree);ExecutorService reader=Executors.newSingleThreadExecutor();
        try{
            LinkedHashMap<String,String> auth=new LinkedHashMap<>();auth.put("Authorization",server.authorization());MediaSources.Lease endpoint=new MediaSources.Lease(HttpUrl.parse(server.url()+entry.davPath),auth);
            control("slow_download");Future<?> blocked=reader.submit(()->{try(Response response=get(endpoint,"bytes=1000-1063")){response.body().bytes();throw new AssertionError("cancelled cloud request completed");}catch(java.io.IOException expected){/* server shutdown closes the client */}catch(Exception error){throw new IllegalStateException(error);}});
            long deadline=System.currentTimeMillis()+5000;while(control(null).optInt("pendingDownloads")==0&&System.currentTimeMillis()<deadline)Thread.sleep(50);
            check(control(null).optInt("pendingDownloads")>0,"cloud lease request actually pending");long stopped=android.os.SystemClock.elapsedRealtime();server.close();blocked.get(3,TimeUnit.SECONDS);
            while(!server.idle()&&android.os.SystemClock.elapsedRealtime()-stopped<2000)Thread.sleep(25);
            check(server.idle()&&android.os.SystemClock.elapsedRealtime()-stopped<2000,"stop cancels underlying lease API instead of waiting ten seconds");Json.put(report,"leaseApiCancellationMs",android.os.SystemClock.elapsedRealtime()-stopped);Json.put(report,"leaseApiCancellationVerified",true);
        }finally{server.close();reader.shutdownNow();control("none");}
    }
}
