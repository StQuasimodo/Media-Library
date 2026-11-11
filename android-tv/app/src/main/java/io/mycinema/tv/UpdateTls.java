package io.mycinema.tv;

import android.content.Context;
import android.os.Build;
import java.io.InputStream;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;
import okhttp3.OkHttpClient;

/** Update-only public trust anchors for Android5, never a permissive trust manager. */
final class UpdateTls {
    static OkHttpClient client(Context context,OkHttpClient base){if(Build.VERSION.SDK_INT>=24)return base;try{X509TrustManager trust=trust(context);SSLContext tls=SSLContext.getInstance("TLS");tls.init(null,new TrustManager[]{trust},new SecureRandom());return base.newBuilder().sslSocketFactory(tls.getSocketFactory(),trust).build();}catch(Exception failure){return base;}}
    private static X509TrustManager manager(KeyStore store)throws Exception{TrustManagerFactory factory=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());factory.init(store);for(TrustManager manager:factory.getTrustManagers())if(manager instanceof X509TrustManager)return (X509TrustManager)manager;throw new CertificateException("No platform X509 trust manager");}
    static X509TrustManager trust(Context context)throws Exception{
        X509TrustManager system=manager(null);KeyStore roots=KeyStore.getInstance(KeyStore.getDefaultType());roots.load(null,null);CertificateFactory parser=CertificateFactory.getInstance("X.509");
        String[][] certificates={{"isrg-root-x1","96bcec06264976f37460779acf28c5a7cfe8a3c0aae11a8ffcee05c0bddf08c6"},{"isrg-root-x2","69729b8e15a86efc177a57afb7171dfc64add28c2fca8cf1507e34453ccb1470"},{"gts-root-r4","349dfa4058c5e263123b398ae795573c4e1313c83fe68f93556cd5e8031b3c7d"}};
        for(String[] expected:certificates)try(InputStream input=context.getAssets().open("update-roots/"+expected[0]+".pem")){X509Certificate certificate=(X509Certificate)parser.generateCertificate(input);String fingerprint=TvUpdates.hex(java.security.MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded()));if(!fingerprint.equals(expected[1]))throw new CertificateException("Public root fingerprint mismatch");roots.setCertificateEntry(expected[0],certificate);}
        X509TrustManager added=manager(roots);X509Certificate[] original=system.getAcceptedIssuers(),extra=added.getAcceptedIssuers(),all=new X509Certificate[original.length+extra.length];System.arraycopy(original,0,all,0,original.length);System.arraycopy(extra,0,all,original.length,extra.length);
        return new X509TrustManager(){public void checkClientTrusted(X509Certificate[] chain,String auth)throws CertificateException{system.checkClientTrusted(chain,auth);}public void checkServerTrusted(X509Certificate[] chain,String auth)throws CertificateException{try{system.checkServerTrusted(chain,auth);}catch(CertificateException untrusted){added.checkServerTrusted(chain,auth);}}public X509Certificate[] getAcceptedIssuers(){return all.clone();}};
    }
}
