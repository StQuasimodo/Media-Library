package io.mycinema.tv;
import okhttp3.*;import java.util.concurrent.*;
public final class BrowserCancellationProbe {public static void main(String[] args)throws Exception{
 NetworkScope scope=new NetworkScope();OkHttpClient client=new OkHttpClient.Builder().readTimeout(5,TimeUnit.SECONDS).build();ExecutorService executor=Executors.newSingleThreadExecutor();CountDownLatch reading=new CountDownLatch(1),finished=new CountDownLatch(1);
 Future<?> task=executor.submit(()->{try(NetworkScope.Exchange exchange=scope.open(client,new Request.Builder().url(args[0]).build())){reading.countDown();exchange.response.body().byteStream().read();}catch(Exception expected){}finally{finished.countDown();}});
 if(!reading.await(2,TimeUnit.SECONDS))throw new IllegalStateException("Fixture did not send headers");Thread.sleep(100);task.cancel(true);boolean futureStopped=finished.await(200,TimeUnit.MILLISECONDS);long begin=System.nanoTime();scope.close();boolean scopeStopped=finished.await(2,TimeUnit.SECONDS);long elapsed=(System.nanoTime()-begin)/1000000;
 executor.shutdownNow();client.connectionPool().evictAll();client.dispatcher().executorService().shutdownNow();
 System.out.println("{\"futureCancellationStoppedReadWithin200ms\":"+futureStopped+",\"scopeCancellationStoppedRead\":"+scopeStopped+",\"scopeCancellationMs\":"+elapsed+"}");
 if(futureStopped||!scopeStopped)throw new IllegalStateException("Unexpected cancellation behavior");}}
