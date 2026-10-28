package io.mycinema.tv;

import android.content.Context;
import android.util.Base64;
import android.util.Xml;
import org.json.JSONArray;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import okhttp3.Cookie;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/** Read-only network sources. Credentials never enter media records or playback intents. */
final class MediaSources {
    static final String UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";
    static final OkHttpClient HTTP=new OkHttpClient.Builder().connectTimeout(15,TimeUnit.SECONDS).readTimeout(25,TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).build();
    static final class Entry {
        final String source,id,name,parent;final boolean directory;final long size;
        Entry(String source,String id,String name,String parent,boolean directory,long size){this.source=source;this.id=id;this.name=name;this.parent=parent;this.directory=directory;this.size=size;}
        boolean video(){return !directory&&name.toLowerCase(java.util.Locale.ROOT).matches(".*\\.(mkv|mp4|m4v|avi|mov|ts|m2ts|mts|wmv|webm|mpg|mpeg|flv)$");}
        String key(){return source+":"+id;}
        JSONObject json(){JSONObject data=new JSONObject();Json.put(data,"source",source);Json.put(data,"fileId",id);Json.put(data,"name",name);Json.put(data,"parent",parent);Json.put(data,"size",size);Json.put(data,"key",key());return data;}
    }
    static final class Lease {
        final HttpUrl url;final Map<String,String> headers;
        Lease(HttpUrl url,Map<String,String> headers){this.url=url;this.headers=headers;}
    }
    private final SecretStore quark,dav;
    MediaSources(Context context){quark=new SecretStore(context,"quark","夸克");dav=new SecretStore(context,"webdav","WebDAV");}
    boolean connected(String source){return store(source).exists();}
    SecretStore store(String source){if(source.equals("quark"))return quark;if(source.equals("webdav"))return dav;throw new IllegalArgumentException("媒体源无效。");}
    void disconnect(String source){store(source).clear();}
    String root(String source) throws Exception {return source.equals("quark")?"0":davUrl(Json.object(dav.read()).optString("url")).toString();}
    static HttpUrl davUrl(String value){
        HttpUrl url=HttpUrl.parse(value.trim());
        if(url==null||!url.username().isEmpty()||!url.password().isEmpty()||url.query()!=null||url.fragment()!=null)throw new IllegalArgumentException("请输入不含账号、查询参数的HTTP或HTTPS WebDAV目录地址。");
        return url.encodedPath().endsWith("/")?url:url.newBuilder().addPathSegment("").build();
    }
    void saveDav(String url,String user,String password) throws Exception {
        HttpUrl base=davUrl(url);if(user.contains(":")||user.contains("\r")||user.contains("\n"))throw new IllegalArgumentException("WebDAV用户名格式无效。");
        JSONObject config=new JSONObject();Json.put(config,"url",base.toString());Json.put(config,"user",user);Json.put(config,"password",password);
        listDav(config,base.toString());dav.save(config.toString());
    }
    void saveQuark(String cookie) throws Exception {
        validateCookie(cookie);listQuark(cookie,"0");quark.save(cookie);
    }
    private static void validateCookie(String cookie){if(cookie.isEmpty()||cookie.length()>20000||!cookie.matches("[\\x20-\\x7e]+"))throw new IllegalArgumentException("尚未取得可用的夸克登录状态。");}
    List<Entry> list(String source,String parent) throws Exception {
        if(!connected(source))throw new IllegalStateException("请先到设置连接媒体源。");
        return source.equals("quark")?listQuark(quark.read(),parent):listDav(Json.object(dav.read()),parent);
    }
    private JSONObject quarkRequest(String cookie,HttpUrl url,RequestBody body) throws Exception {
        Request.Builder request=new Request.Builder().url(url).header("Cookie",cookie).header("Referer","https://pan.quark.cn/").header("User-Agent",UA);
        if(body!=null)request.post(body);
        try(Response response=HTTP.newCall(request.build()).execute()){
            requireSuccess(response,"夸克");JSONObject json=Json.object(new String(TmdbClient.read(response.body().byteStream(),2*1024*1024),StandardCharsets.UTF_8));
            if(json.optInt("code",-1)!=0||json.optInt("status",0)!=200)throw new IllegalStateException("夸克请求未通过，请重新连接账号或检查官方页面的访问限制。");
            // Persist only renewal of the session cookie issued by the API host.
            String updated=cookie;
            for(Cookie renewal:Cookie.parseAll(url,response.headers()))if(renewal.name().equals("__puus")){
                updated=updated.replaceAll("(?i)(^|;\\s*)__puus=[^;]*","").replaceAll("^;\\s*","");updated+=(updated.isEmpty()?"":"; ")+"__puus="+renewal.value();
            }
            if(!updated.equals(cookie)&&quark.exists())quark.save(updated);
            return json;
        }
    }
    private static HttpUrl.Builder api(String path){return HttpUrl.parse("https://drive-pc.quark.cn/1/clouddrive/"+path).newBuilder().addQueryParameter("pr","ucpro").addQueryParameter("fr","pc");}
    private List<Entry> listQuark(String cookie,String parent) throws Exception {
        validateCookie(cookie);if(parent.isEmpty()||parent.length()>1024)throw new IllegalArgumentException("文件夹标识无效。");
        List<Entry> items=new ArrayList<>();Set<String> seen=new HashSet<>();int total=-1;
        for(int page=1;page<=100;page++){
            interrupted();JSONObject data=quarkRequest(cookie,api("file/sort").addQueryParameter("pdir_fid",parent).addQueryParameter("_page",String.valueOf(page)).addQueryParameter("_size","100").addQueryParameter("_fetch_total","1").build(),null);
            JSONObject metadata=data.optJSONObject("metadata");int expected=metadata==null?-1:metadata.optInt("_total",-1);
            JSONObject payload=data.optJSONObject("data");JSONArray rows=payload==null?null:payload.optJSONArray("list");
            if(rows==null||expected<0||expected>10000||(total>=0&&total!=expected))throw new IllegalStateException("夸克目录不完整或读取期间发生变化，请重试。");total=expected;
            for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);String id=Json.text(row,"fid"),name=Json.text(row,"file_name");if(id.isEmpty()||name.isEmpty()||!row.has("file")||!seen.add(id))throw new IllegalStateException("夸克目录分页异常，未保存本次扫描。");items.add(new Entry("quark",id,name,parent,!row.getBoolean("file"),row.optLong("size",0)));}
            if(items.size()==total)return items;if(rows.length()==0||items.size()>total)break;
        }
        throw new IllegalStateException("夸克目录超过读取上限或分页不完整，请选择较小目录。");
    }
    static boolean sameOrigin(HttpUrl a,HttpUrl b){return a.scheme().equals(b.scheme())&&a.host().equals(b.host())&&a.port()==b.port();}
    private static String basic(JSONObject config){return "Basic "+Base64.encodeToString((Json.text(config,"user")+":"+Json.text(config,"password")).getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP);}
    static HttpUrl davChild(HttpUrl root,String value){
        HttpUrl url=root.resolve(value);
        if(url==null||!sameOrigin(root,url)||!url.username().isEmpty()||!url.password().isEmpty()||url.query()!=null||url.fragment()!=null||!url.encodedPath().startsWith(root.encodedPath()))throw new IllegalStateException("WebDAV返回了配置目录以外的地址，已停止读取。");return url;
    }
    private List<Entry> listDav(JSONObject config,String parent) throws Exception {
        HttpUrl root=davUrl(Json.text(config,"url")),folder=davChild(root,parent);
        String xml="<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/><d:getcontentlength/><d:displayname/></d:prop></d:propfind>";
        Request request=new Request.Builder().url(folder).header("Authorization",basic(config)).header("Depth","1").method("PROPFIND",RequestBody.create(MediaType.parse("application/xml; charset=utf-8"),xml)).build();
        try(Response response=HTTP.newCall(request).execute()){
            if(response.code()!=207){requireSuccess(response,"WebDAV");throw new IllegalStateException("该地址没有返回WebDAV目录，请检查地址。");}
            byte[] bytes=TmdbClient.read(response.body().byteStream(),2*1024*1024);
            return parseDav(bytes,root,folder);
        }
    }
    static List<Entry> parseDav(byte[] bytes,HttpUrl root,HttpUrl folder) throws Exception {
        if(new String(bytes,StandardCharsets.UTF_8).toUpperCase(java.util.Locale.ROOT).contains("<!DOCTYPE"))throw new IllegalStateException("WebDAV目录XML包含不支持的声明。");
        XmlPullParser parser=Xml.newPullParser();parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES,true);parser.setInput(new ByteArrayInputStream(bytes),null);
        List<Entry> result=new ArrayList<>();Set<String> seen=new HashSet<>();String href="",display="",status="";boolean collection=false,inProp=false,valid=false,propCollection=false,rootSeen=false;long size=0,propSize=0;String propDisplay="";
        for(int event=parser.next();event!=XmlPullParser.END_DOCUMENT;event=parser.next()){
            if(event==XmlPullParser.START_TAG&&"DAV:".equals(parser.getNamespace())){
                String tag=parser.getName();if(tag.equals("multistatus"))rootSeen=true;
                if(tag.equals("response")){href="";display="";size=0;collection=false;valid=false;}
                else if(tag.equals("href"))href=parser.nextText();
                else if(tag.equals("propstat")){inProp=true;status="";propCollection=false;propSize=0;propDisplay="";}
                else if(tag.equals("status"))status=parser.nextText();
                else if(inProp&&tag.equals("collection"))propCollection=true;
                else if(inProp&&tag.equals("displayname"))propDisplay=parser.nextText();
                else if(inProp&&tag.equals("getcontentlength")){try{propSize=Long.parseLong(parser.nextText());}catch(NumberFormatException ignored){propSize=0;}}
            }else if(event==XmlPullParser.END_TAG&&"DAV:".equals(parser.getNamespace())){
                if(parser.getName().equals("propstat")){if(status.matches("HTTP/\\S+ 200.*")){valid=true;collection|=propCollection;if(!propDisplay.isEmpty())display=propDisplay;if(propSize>0)size=propSize;}inProp=false;}
                if(parser.getName().equals("response")&&valid&&!href.isEmpty()){
                    HttpUrl resolved=folder.resolve(href);if(resolved==null)throw new IllegalStateException("WebDAV文件地址无效。");HttpUrl url=davChild(root,resolved.toString());String path=url.encodedPath(),base=folder.encodedPath();if(path.equals(base)||path.equals(base.replaceAll("/$","")))continue;
                    if(!path.startsWith(base))throw new IllegalStateException("WebDAV目录层级异常。");String relative=path.substring(base.length()).replaceAll("/$","");if(relative.isEmpty()||relative.contains("/"))continue;
                    if(!seen.add(url.toString()))continue;
                    if(collection&&!url.encodedPath().endsWith("/"))url=url.newBuilder().addPathSegment("").build();String name=UriName(url);result.add(new Entry("webdav",url.toString(),display.isEmpty()?name:display,folder.toString(),collection,size));
                    if(result.size()>10000)throw new IllegalStateException("WebDAV目录过大，请选择较小目录。");
                }
            }
        }
        if(!rootSeen)throw new IllegalStateException("WebDAV没有返回标准目录XML。");return result;
    }
    private static String UriName(HttpUrl url){List<String> segments=url.pathSegments();return segments.get(segments.size()-1).isEmpty()&&segments.size()>1?segments.get(segments.size()-2):segments.get(segments.size()-1);}
    Lease resolve(JSONObject file) throws Exception {
        String source=Json.text(file,"source"),id=Json.text(file,"fileId");Map<String,String> headers=new LinkedHashMap<>();
        if(source.equals("webdav")){JSONObject config=Json.object(dav.read());HttpUrl url=davChild(davUrl(Json.text(config,"url")),id);headers.put("Authorization",basic(config));return new Lease(url,headers);}
        if(!source.equals("quark"))throw new IllegalArgumentException("媒体源无效。");String cookie=quark.read();validateCookie(cookie);
        JSONObject body=new JSONObject();Json.put(body,"fids",new JSONArray().put(id));JSONObject result=quarkRequest(cookie,api("file/download").build(),RequestBody.create(MediaType.parse("application/json"),body.toString()));
        JSONArray rows=result.optJSONArray("data");String value=rows!=null&&rows.length()>0?rows.getJSONObject(0).optString("download_url"):"";HttpUrl url=HttpUrl.parse(value);
        if(url==null||!url.isHttps()||!url.username().isEmpty()||!url.password().isEmpty())throw new IllegalStateException("夸克未返回可用的HTTPS播放地址，请检查账号权限或稍后重试。");
        headers.put("Referer","https://pan.quark.cn/");headers.put("User-Agent",UA);
        if(quarkHost(url.host()))headers.put("Cookie",quark.read());return new Lease(url,headers);
    }
    static boolean quarkHost(String host){return host.equals("quark.cn")||host.endsWith(".quark.cn")||host.endsWith(".quark-hdb.com")||host.equals("uc.cn")||host.endsWith(".uc.cn");}
    static void requireSuccess(Response response,String source){int code=response.code();if(code==401)throw new IllegalStateException(source+"登录已失效或账号密码不正确，请重新连接。");if(code<200||code>=300)throw new IllegalStateException(source+"请求失败（HTTP "+code+"），请检查权限、地址或稍后重试。");}
    static void interrupted() throws InterruptedException {if(Thread.currentThread().isInterrupted())throw new InterruptedException();}
}
