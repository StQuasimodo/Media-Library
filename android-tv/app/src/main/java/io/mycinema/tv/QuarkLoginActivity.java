package io.mycinema.tv;

import android.app.Activity;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Official web login only; no JS bridge, TLS bypass or plaintext credential entry. */
public final class QuarkLoginActivity extends Activity {
    private WebView web;private TextView status;private Button verify;private boolean disposed;
    private final ExecutorService jobs=Executors.newSingleThreadExecutor();
    @Override public void onCreate(Bundle state){
        super.onCreate(state);LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setBackgroundColor(MainActivity.SPACE);
        status=new TextView(this);status.setTextColor(MainActivity.PRIMARY);status.setTextSize(17);status.setPadding(24,12,24,12);status.setText("夸克账号 · 请用手机扫描官方页面的二维码。完成后选择「检查并保存登录」。旧电视若无法显示页面，请返回，勿忽略证书错误。");layout.addView(status);
        LinearLayout buttons=new LinearLayout(this);verify=new Button(this);verify.setText("检查并保存登录");verify.setOnClickListener(v->verify());buttons.addView(verify);Button back=new Button(this);back.setText("返回");back.setOnClickListener(v->finish());buttons.addView(back);layout.addView(buttons);
        web=new WebView(this);WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setUserAgentString(MediaSources.UA);settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,String url){return !allowed(url);}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !allowed(request.getUrl().toString());}
            @Override public void onPageStarted(WebView view,String url,Bitmap icon){if(!allowed(url)){view.stopLoading();status.setText("已阻止非夸克登录页面。请返回后重试。");}}
            @Override public void onReceivedError(WebView view,int code,String description,String failingUrl){status.setText("官方登录页面加载失败。该电视的WebView或网络可能不兼容，请返回重试。");}
        });layout.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(layout);web.loadUrl("https://pan.quark.cn/list");
    }
    private static boolean allowed(String value){okhttp3.HttpUrl url=okhttp3.HttpUrl.parse(value);return url!=null&&url.isHttps()&&url.port()==443&&url.username().isEmpty()&&url.password().isEmpty()&&(url.host().equals("quark.cn")||url.host().endsWith(".quark.cn"));}
    private void verify(){String cookie=CookieManager.getInstance().getCookie("https://drive-pc.quark.cn/");if(cookie==null||cookie.isEmpty())cookie=CookieManager.getInstance().getCookie("https://pan.quark.cn/");final String captured=cookie==null?"":cookie;verify.setEnabled(false);status.setText("正在验证目录权限并加密保存…");jobs.execute(()->{boolean success=false;String message="";try{new MediaSources(this).saveQuark(captured);success=true;}catch(Exception error){message=error instanceof IllegalStateException||error instanceof IllegalArgumentException?error.getMessage():"登录验证失败，请检查网络或官方页面后重试。";}final boolean saved=success;final String reason=message;runOnUiThread(()->{if(disposed)return;verify.setEnabled(true);if(saved){CookieManager.getInstance().removeAllCookies(removed->{CookieManager.getInstance().flush();if(!disposed){setResult(RESULT_OK);finish();}});}else status.setText(reason);});});}
    @Override protected void onPause(){if(web!=null)web.onPause();super.onPause();}
    @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();}
    @Override protected void onDestroy(){disposed=true;jobs.shutdownNow();if(web!=null){web.stopLoading();web.destroy();web=null;}CookieManager.getInstance().removeAllCookies(removed->CookieManager.getInstance().flush());super.onDestroy();}
}
