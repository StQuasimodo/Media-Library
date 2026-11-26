package io.mycinema.tv;

import static org.junit.Assert.*;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.HttpUrl;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okhttp3.mockwebserver.SocketPolicy;
import okio.Buffer;
import org.json.JSONObject;
import org.junit.Test;

public final class StreamTransportTest {
    private static final int PART=(int)MediaTransfer.SEGMENT_BYTES;
    private static final int TOTAL=PART*2+1024;

    @Test public void exactRangesAndCounts() throws Exception { run(null,false); }
    @Test public void distinguishesWaitingForAddress() throws Exception { run(StreamMetrics.Step.ADDRESS,false); }
    @Test public void distinguishesWaitingForHeaders() throws Exception { run(StreamMetrics.Step.RESPONSE,false); }
    @Test public void distinguishesWaitingForBody() throws Exception { run(StreamMetrics.Step.READ,false); }
    @Test public void distinguishesBlockedConsumer() throws Exception { run(StreamMetrics.Step.WRITE,false); }
    @Test public void resumesShortBodyAndPreservesBytes() throws Exception { run(null,true); }

    private void run(StreamMetrics.Step stalled,boolean truncate) throws Exception {
        byte[] fixture=new byte[TOTAL];
        for(int i=0;i<fixture.length;i++)fixture[i]=(byte)(i*31+(i>>>14));
        CountDownLatch release=new CountDownLatch(1);
        AtomicBoolean used=new AtomicBoolean();
        AtomicBoolean shortBody=new AtomicBoolean(truncate);
        List<String> ranges=Collections.synchronizedList(new ArrayList<>());
        MockWebServer origin=new MockWebServer();
        origin.setDispatcher(new Dispatcher(){
            @Override public MockResponse dispatch(RecordedRequest request) throws InterruptedException {
                String range=request.getHeader("Range");
                ranges.add(range);
                String[] parts=range.substring(6).split("-");
                int first=Integer.parseInt(parts[0]),last=Integer.parseInt(parts[1]);
                if(stalled==StreamMetrics.Step.RESPONSE&&used.compareAndSet(false,true)
                    &&!release.await(6,TimeUnit.SECONDS))return new MockResponse().setResponseCode(503);
                MockResponse response=new MockResponse().setResponseCode(206)
                    .setHeader("Content-Range","bytes "+first+"-"+last+"/"+TOTAL)
                    .setHeader("ETag","controlled-transport-v1")
                    .setBody(new Buffer().write(fixture,first,last-first+1));
                if(stalled==StreamMetrics.Step.READ&&used.compareAndSet(false,true))response.setBodyDelay(1,TimeUnit.SECONDS);
                if(shortBody.compareAndSet(true,false))response.setSocketPolicy(SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY);
                return response;
            }
        });
        origin.start();
        ExecutorService caller=Executors.newSingleThreadExecutor();
        HttpUrl endpoint=origin.url("/media");
        MediaTransfer transfer=new MediaTransfer((file,scope)->{
            if(stalled==StreamMetrics.Step.ADDRESS&&used.compareAndSet(false,true))waitFor(release);
            return new MediaSources.Lease(endpoint,Collections.emptyMap());
        });
        JSONObject file=new JSONObject().put("source","quark").put("fileId","synthetic");
        ByteArrayOutputStream result=new ByteArrayOutputStream();
        try(NetworkScope scope=new NetworkScope()){
            Future<?> response=caller.submit(()->{
                transfer.serve(file,"bytes=0-",false,new OutputStream(){
                    @Override public void write(int value){result.write(value);}
                    @Override public void write(byte[] bytes,int first,int count) throws IOException{
                        if(stalled==StreamMetrics.Step.WRITE&&result.size()!=0&&used.compareAndSet(false,true))waitFor(release);
                        result.write(bytes,first,count);
                    }
                },scope);
                return null;
            });
            if(stalled!=null){
                long elapsed=System.nanoTime()+TimeUnit.SECONDS.toNanos(4);
                while(transfer.metrics().snapshot().currentMs(stalled)<35&&System.nanoTime()<elapsed)Thread.sleep(5);
                StreamMetrics.Snapshot waiting=transfer.metrics().snapshot();
                assertTrue("live wait is visible for "+stalled,waiting.currentMs(stalled)>=35);
                for(StreamMetrics.Step other:StreamMetrics.Step.values()){
                    if(other!=stalled)assertEquals("only the blocked operation is active",0,waiting.currentMs(other));
                }
                if(stalled==StreamMetrics.Step.WRITE){
                    assertTrue(waiting.received>waiting.forwarded);
                    assertEquals("a new Range cannot start while the consumer is blocked",1,ranges.size());
                }
                release.countDown();
            }
            response.get(8,TimeUnit.SECONDS);
            byte[] sent=result.toByteArray();
            int headerBytes=new String(sent,0,Math.min(sent.length,512),StandardCharsets.US_ASCII).indexOf("\r\n\r\n")+4;
            assertTrue(headerBytes>4);
            assertArrayEquals(fixture,Arrays.copyOfRange(sent,headerBytes,sent.length));
            StreamMetrics.Snapshot after=transfer.metrics().snapshot();
            assertEquals(TOTAL,after.received);
            assertEquals(TOTAL,after.forwarded);
            assertEquals(truncate?4:3,after.responses);
            assertEquals(truncate?1:0,after.retries);
            assertEquals("bytes=0-"+(PART-1),ranges.get(0));
            if(truncate)assertEquals("bytes="+(PART/2)+"-"+(PART-1),ranges.get(1));
            if(stalled!=null){
                assertEquals(0,after.currentMs(stalled));
                assertTrue(after.maxMs(stalled)>=35);
            }
        }finally{
            release.countDown();
            caller.shutdownNow();
            transfer.close();
            origin.shutdown();
        }
    }

    @Test public void refusedLookaheadFallsBackAtExactOffset() throws Exception {
        checkLookahead(false,true);
    }

    @Test public void overlappingResponsesAreForwardedInByteOrder() throws Exception {
        checkLookahead(false,false);
    }

    @Test public void cancelOverlappingRangesWhileWaitingForHeaders() throws Exception {
        checkLookahead(true,false);
    }

    private void checkLookahead(boolean cancel,boolean reject) throws Exception {
        int total=PART*3;
        byte[] fixture=new byte[total];
        for(int i=0;i<total;i++)fixture[i]=(byte)((i/PART)*47+(i%251));
        CountDownLatch overlap=new CountDownLatch(2);
        CountDownLatch release=new CountDownLatch(1);
        AtomicBoolean rejectOnce=new AtomicBoolean(reject);
        MockWebServer origin=new MockWebServer();
        origin.setDispatcher(new Dispatcher(){
            @Override public MockResponse dispatch(RecordedRequest request) throws InterruptedException {
                String[] bounds=request.getHeader("Range").substring(6).split("-");
                int first=Integer.parseInt(bounds[0]);
                int last=Integer.parseInt(bounds[1]);
                if(first>=PART){
                    overlap.countDown();
                    if(!overlap.await(6,TimeUnit.SECONDS)||!release.await(6,TimeUnit.SECONDS))
                        return new MockResponse().setResponseCode(503);
                    if(first==PART && rejectOnce.compareAndSet(true,false))
                        return new MockResponse().setResponseCode(429);
                }
                return new MockResponse().setResponseCode(206)
                    .setHeader("Content-Range","bytes "+first+"-"+last+"/"+total)
                    .setHeader("ETag","stable")
                    .setBody(new Buffer().write(fixture,first,last-first+1));
            }
        });
        origin.start();
        HttpUrl endpoint=origin.url("/movie");
        MediaTransfer transfer=new MediaTransfer((file,scope)->new MediaSources.Lease(endpoint,Collections.emptyMap()));
        ExecutorService caller=Executors.newSingleThreadExecutor();
        try(NetworkScope scope=new NetworkScope()){
            JSONObject file=new JSONObject().put("source","quark").put("fileId","fixture");
            ByteArrayOutputStream result=new ByteArrayOutputStream();
            Future<?> delivery=caller.submit(()->{
                transfer.serve(file,"bytes=0-",false,result,scope,transfer.metrics(),true);
                return null;
            });
            assertTrue("later requests overlap before the previous headers arrive",overlap.await(5,TimeUnit.SECONDS));
            if(cancel)scope.close();
            else release.countDown();
            delivery.get(4,TimeUnit.SECONDS);
            if(cancel){
                assertTrue(transfer.metrics().snapshot().forwarded<=PART);
            }else{
                byte[] sent=result.toByteArray();
                int header=new String(sent,0,512,StandardCharsets.US_ASCII).indexOf("\r\n\r\n")+4;
                assertTrue(header>4);
                assertArrayEquals(fixture,Arrays.copyOfRange(sent,header,sent.length));
                assertEquals(reject?1:0,transfer.metrics().snapshot().retries);
            }
        }finally{
            release.countDown();
            caller.shutdownNow();
            transfer.close();
            origin.shutdown();
        }
    }

    private static void waitFor(CountDownLatch latch) throws IOException {
        try{
            if(!latch.await(6,TimeUnit.SECONDS))throw new IOException("controlled gate timed out");
        }catch(InterruptedException stop){Thread.currentThread().interrupt();throw new IOException(stop);}
    }
}
