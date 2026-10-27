package io.mycinema.tv;

import android.content.Context;
import android.security.KeyPairGeneratorSpec;
import android.util.AtomicFile;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.Certificate;
import java.util.Arrays;
import java.util.Calendar;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import javax.security.auth.x500.X500Principal;

/** API 21-compatible Keystore RSA wraps random AES/HMAC keys; no plaintext fallback. */
final class SecretStore {
    private static final String ALIAS="my-cinema-tv-metadata-v1";
    private final Context context;
    private final AtomicFile file;
    SecretStore(Context context){this.context=context.getApplicationContext();file=new AtomicFile(new File(context.getFilesDir(),"metadata-credential.bin"));}
    boolean exists(){return file.getBaseFile().exists();}
    synchronized void clear(){file.delete();}
    private KeyStore keys() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);return store;
    }
    @SuppressWarnings("deprecation")
    private KeyStore ensureKeys() throws Exception {
        KeyStore store=keys();if(store.containsAlias(ALIAS))return store;
        Calendar start=Calendar.getInstance(),end=Calendar.getInstance();end.add(Calendar.YEAR,25);
        KeyPairGenerator generator=KeyPairGenerator.getInstance("RSA","AndroidKeyStore");
        generator.initialize(new KeyPairGeneratorSpec.Builder(context).setAlias(ALIAS).setKeySize(2048)
            .setSubject(new X500Principal("CN=My Cinema TV")).setSerialNumber(BigInteger.ONE)
            .setStartDate(start.getTime()).setEndDate(end.getTime()).build());generator.generateKeyPair();return keys();
    }
    synchronized void save(String value) throws Exception {
        if(value.trim().isEmpty()||value.length()>4096)throw new IllegalArgumentException("TMDB凭据为空或过长。");
        byte[] material=new byte[64],iv=new byte[16];SecureRandom random=new SecureRandom();random.nextBytes(material);random.nextBytes(iv);
        Cipher cipher=Cipher.getInstance("AES/CBC/PKCS5Padding");cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(Arrays.copyOfRange(material,0,32),"AES"),new IvParameterSpec(iv));
        byte[] encrypted=cipher.doFinal(value.trim().getBytes(StandardCharsets.UTF_8));
        Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(Arrays.copyOfRange(material,32,64),"HmacSHA256"));mac.update(iv);byte[] tag=mac.doFinal(encrypted);
        Certificate cert=ensureKeys().getCertificate(ALIAS);Cipher rsa=Cipher.getInstance("RSA/ECB/PKCS1Padding");rsa.init(Cipher.ENCRYPT_MODE,cert.getPublicKey());byte[] wrapped=rsa.doFinal(material);
        ByteArrayOutputStream buffer=new ByteArrayOutputStream();DataOutputStream out=new DataOutputStream(buffer);
        out.writeInt(0x4d435401);out.writeShort(wrapped.length);out.write(wrapped);out.write(iv);out.writeInt(encrypted.length);out.write(encrypted);out.write(tag);
        FileOutputStream output=null;try{output=file.startWrite();output.write(buffer.toByteArray());file.finishWrite(output);}catch(Exception error){if(output!=null)file.failWrite(output);throw new IllegalStateException("无法安全保存TMDB凭据。",error);}finally{Arrays.fill(material,(byte)0);}
    }
    synchronized String read() throws Exception {
        if(!exists())return "";
        try {
            byte[] data=file.readFully();if(data.length>16384)throw new IllegalArgumentException();
            DataInputStream input=new DataInputStream(new ByteArrayInputStream(data));if(input.readInt()!=0x4d435401)throw new IllegalArgumentException();
            int wrappedSize=input.readUnsignedShort();if(wrappedSize!=256)throw new IllegalArgumentException();
            byte[] wrapped=new byte[wrappedSize],iv=new byte[16];input.readFully(wrapped);input.readFully(iv);
            int size=input.readInt();if(size<=0||size>8192)throw new IllegalArgumentException();byte[] encrypted=new byte[size],tag=new byte[32];input.readFully(encrypted);input.readFully(tag);if(input.available()!=0)throw new IllegalArgumentException();
            Cipher rsa=Cipher.getInstance("RSA/ECB/PKCS1Padding");rsa.init(Cipher.DECRYPT_MODE,keys().getKey(ALIAS,null));byte[] material=rsa.doFinal(wrapped);
            if(material.length!=64)throw new IllegalArgumentException();
            Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(Arrays.copyOfRange(material,32,64),"HmacSHA256"));mac.update(iv);
            if(!MessageDigest.isEqual(tag,mac.doFinal(encrypted)))throw new IllegalArgumentException();
            Cipher cipher=Cipher.getInstance("AES/CBC/PKCS5Padding");cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(Arrays.copyOfRange(material,0,32),"AES"),new IvParameterSpec(iv));
            String value=new String(cipher.doFinal(encrypted),StandardCharsets.UTF_8);Arrays.fill(material,(byte)0);return value;
        }catch(Exception error){throw new IllegalStateException("已保存的TMDB配置无法读取，请到设置重新保存。");}
    }
}
