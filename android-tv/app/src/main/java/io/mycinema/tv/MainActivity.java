package io.mycinema.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.GridView;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native remote-first TV presentation; collection storage is independent of playback. */
public final class MainActivity extends Activity {
    static final int SPACE=0xff101216,CONTENT=0xff171a21,PRIMARY=0xffe9ecf2,SECONDARY=0xff9299a6,ACCENT=0xff8ab4ff;
    private Library library;
    private Artwork artwork;
    private SecretStore secrets;
    private final ExecutorService jobs=Executors.newSingleThreadExecutor();
    private final ArrayDeque<Page> history=new ArrayDeque<>();
    private FrameLayout body;
    private ImageView backdrop;
    private TextView busy;
    private String screen="home",value="",query="",status="",series="",sort="recent",searchType="movie",searchQuery="",focusedFilm="";
    private String language="zh-CN";
    private List<JSONObject> searchResults=new ArrayList<>();
    private JSONObject pendingCandidate,seasonData;
    private String seasonId="";
    private final Set<Integer> selectedSeasons=new TreeSet<>();
    private int generation;
    private int yearFilter;
    private int focusedSeason=-1;
    private boolean disposed,working;
    private static final class Page {final String screen,value;Page(String screen,String value){this.screen=screen;this.value=value;}}
    interface Work<T>{T run() throws Exception;}
    interface Done<T>{void run(T value);}

    @Override public void onCreate(Bundle state){
        super.onCreate(state);getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,WindowManager.LayoutParams.FLAG_FULLSCREEN);
        immersive();
        library=new Library(this);artwork=new Artwork(this);secrets=new SecretStore(this);
        language=getPreferences(0).getString("language","zh-CN");
        FrameLayout root=new FrameLayout(this);root.setBackgroundColor(SPACE);
        backdrop=new ImageView(this);backdrop.setId(R.id.cinema_backdrop);backdrop.setScaleType(ImageView.ScaleType.CENTER_CROP);root.addView(backdrop,new FrameLayout.LayoutParams(-1,-1));
        View shade=new View(this);shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,new int[]{0xf5101216,0xc0101216,0x99101216}));root.addView(shade,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout layout=column();layout.setPadding(dp(32),dp(12),dp(32),dp(16));root.addView(layout,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout nav=row();nav.setGravity(Gravity.CENTER_VERTICAL);TextView brand=text("My Cinema",23,PRIMARY);brand.setTypeface(Typeface.create("serif",Typeface.ITALIC));nav.addView(brand,new LinearLayout.LayoutParams(dp(160),dp(48)));
        String[] labels={"首页","影视库","专题","想看","设置"},routes={"home","library","collections","watchlist","settings"};
        int[] ids={R.id.nav_home,R.id.nav_library,R.id.nav_collections,R.id.nav_watchlist,R.id.nav_settings};
        for(int i=0;i<labels.length;i++){final String route=routes[i];Button button=button(labels[i],()->top(route));button.setId(ids[i]);nav.addView(button,new LinearLayout.LayoutParams(dp(76),dp(44)));}
        busy=text("",12,SECONDARY);busy.setGravity(Gravity.END|Gravity.CENTER_VERTICAL);nav.addView(busy,new LinearLayout.LayoutParams(0,dp(44),1));layout.addView(nav);
        body=new FrameLayout(this);layout.addView(body,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);
        if(state!=null){screen=state.getString("screen","home");value=state.getString("value","");focusedFilm=state.getString("focused","");if(screen.equals("candidate")||screen.equals("seasons"))screen="home";}
        show(screen,value);
    }
    @Override protected void onResume(){super.onResume();if(body!=null&&screen.equals("film"))show(screen,value);}
    @Override protected void onSaveInstanceState(Bundle out){super.onSaveInstanceState(out);out.putString("screen",screen);out.putString("value",value);out.putString("focused",focusedFilm);}
    @Override public void onWindowFocusChanged(boolean focused){super.onWindowFocusChanged(focused);if(focused)immersive();}
    private void immersive(){getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);}
    @Override protected void onDestroy(){disposed=true;jobs.shutdownNow();if(artwork!=null)artwork.close();if(library!=null)library.close();super.onDestroy();}
    @Override public void onBackPressed(){if(!history.isEmpty()){Page page=history.pop();show(page.screen,page.value);}else if(!screen.equals("home"))top("home");else confirm("退出 My Cinema？","收藏已保存在电视本机。",this::finish);}
    private void top(String route){history.clear();query="";status="";series="";yearFilter=0;show(route,"");}
    private void push(String route,String id){history.push(new Page(screen,value));if(route.equals("collection")){query="";status="";series="";yearFilter=0;}show(route,id);}
    private void show(String route,String id){
        screen=route;value=id;generation++;body.removeAllViews();backdrop.setImageDrawable(null);
        for(int nav:new int[]{R.id.nav_home,R.id.nav_library,R.id.nav_collections,R.id.nav_watchlist,R.id.nav_settings})findViewById(nav).setSelected(false);
        int selected=route.equals("home")?R.id.nav_home:route.equals("collections")||route.equals("collection")?R.id.nav_collections:route.equals("watchlist")?R.id.nav_watchlist:route.equals("settings")?R.id.nav_settings:R.id.nav_library;findViewById(selected).setSelected(true);
        try{
            switch(route){case "home":home();break;case "library":case "watchlist":case "collection":wall();break;case "film":detail(id);break;case "collections":collections();break;case "settings":settings();break;case "search":search();break;case "seasons":seasons();break;case "candidate":candidate();break;default:top("home");}
        }catch(Exception error){LinearLayout content=page("暂时无法显示","");content.addView(text(message(error),18,SECONDARY));content.addView(button("返回首页",()->top("home")));}
    }
    private TmdbClient tmdb(){return new TmdbClient(secrets,language);}
    private <T> void job(String label,Work<T> work,Done<T> done){
        if(working){toast("上一项操作仍在进行，请稍候。");return;}working=true;busy.setText(label);int owner=generation;
        jobs.execute(()->{T result=null;Exception failure=null;try{result=work.run();}catch(Exception error){failure=error;}final T answer=result;final Exception error=failure;
            runOnUiThread(()->{if(disposed)return;working=false;busy.setText("");if(error!=null){toast(message(error));return;}if(owner==generation)done.run(answer);else toast("操作已完成，收藏已保存在本机。");});
        });
    }
    private static String message(Exception error){String text=error.getMessage();return error instanceof IllegalArgumentException||error instanceof IllegalStateException?text==null?"操作失败，请重试。":text:"操作未完成，请检查网络、存储空间或输入内容。";}
    private int dp(float size){return Math.round(getResources().getDisplayMetrics().density*size);}
    private LinearLayout column(){LinearLayout view=new LinearLayout(this);view.setOrientation(LinearLayout.VERTICAL);return view;}
    private LinearLayout row(){LinearLayout view=new LinearLayout(this);view.setOrientation(LinearLayout.HORIZONTAL);return view;}
    private TextView text(String value,int size,int color){TextView view=new TextView(this);view.setText(value);view.setTextSize(size);view.setTextColor(color);view.setPadding(0,dp(4),0,dp(4));return view;}
    private GradientDrawable surface(int color,int stroke){GradientDrawable drawable=new GradientDrawable();drawable.setColor(color);drawable.setCornerRadius(dp(6));if(stroke!=0)drawable.setStroke(dp(2),stroke);return drawable;}
    private StateListDrawable focusBackground(){StateListDrawable states=new StateListDrawable();states.addState(new int[]{android.R.attr.state_focused},surface(0xff282f3b,ACCENT));states.addState(new int[]{android.R.attr.state_selected},surface(0x301d222c,0));states.addState(new int[]{},surface(0x00101216,0));return states;}
    private Button button(String label,Runnable action){Button view=new Button(this);view.setAllCaps(false);view.setText(label);view.setTextSize(14);view.setTextColor(PRIMARY);view.setBackground(focusBackground());view.setPadding(dp(12),dp(8),dp(12),dp(8));view.setMinHeight(dp(44));view.setOnClickListener(v->action.run());return view;}
    private void toast(String text){Toast.makeText(this,text,Toast.LENGTH_LONG).show();}
    private LinearLayout page(String title,String eyebrow){
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);LinearLayout content=column();content.setPadding(dp(4),dp(12),dp(4),dp(24));scroll.addView(content);body.addView(scroll,new FrameLayout.LayoutParams(-1,-1));
        if(!eyebrow.isEmpty())content.addView(text(eyebrow,11,SECONDARY));TextView heading=text(title,30,PRIMARY);heading.setTypeface(Typeface.DEFAULT,Typeface.BOLD);content.addView(heading);return content;
    }
    private String meta(Library.Item item){String year=item.film.isNull("year")?"":String.valueOf(item.film.optInt("year"));int runtime=item.film.optInt("runtime");String rating=item.entry.isNull("personalRating")?"":"  ·  ★ "+item.entry.optDouble("personalRating");return year+(runtime>0?"  ·  "+runtime+" 分钟":"")+rating;}
    private static String statusLabel(String status){switch(status){case "watching":return "观看中";case "watched":return "已看完";case "dropped":return "暂不观看";default:return "想看";}}
    private FrameLayout poster(Library.Item item,int width){
        FrameLayout frame=new FrameLayout(this);frame.setBackground(surface(CONTENT,0));ImageView image=new ImageView(this);image.setScaleType(ImageView.ScaleType.CENTER_CROP);frame.addView(image,new FrameLayout.LayoutParams(-1,-1));artwork.load(image,Json.text(item.film,"posterPath"),width,width*3/2);
        TextView label=text(item.title(),13,PRIMARY);label.setBackgroundColor(0xbb101216);label.setMaxLines(2);label.setPadding(dp(7),dp(5),dp(7),dp(5));FrameLayout.LayoutParams lp=new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM);frame.addView(label,lp);frame.setContentDescription(item.title());return frame;
    }
    private static final class PosterHolder {final ImageView image;final TextView label;PosterHolder(ImageView image,TextView label){this.image=image;this.label=label;}}
    private View gridPoster(Library.Item item,View recycled){
        FrameLayout frame=recycled instanceof FrameLayout?(FrameLayout)recycled:null;
        if(frame==null){frame=new FrameLayout(this);frame.setBackground(surface(CONTENT,0));ImageView image=new ImageView(this);image.setScaleType(ImageView.ScaleType.CENTER_CROP);frame.addView(image,new FrameLayout.LayoutParams(-1,-1));TextView label=text("",13,PRIMARY);label.setMaxLines(2);label.setBackgroundColor(0xbb101216);frame.addView(label,new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM));frame.setTag(new PosterHolder(image,label));frame.setLayoutParams(new android.widget.AbsListView.LayoutParams(-1,dp(220)));}
        PosterHolder holder=(PosterHolder)frame.getTag();holder.label.setText(item.title());artwork.load(holder.image,Json.text(item.film,"posterPath"),140,210);frame.setContentDescription(item.title());return frame;
    }
    private void home(){
        List<Library.Item> items=library.list("","","","","recent");if(items.isEmpty()){LinearLayout content=page("属于你的私人放映室","MY CINEMA");content.addView(text("搜索一部作品，开始建立电视上的收藏。",18,SECONDARY));content.addView(button("从TMDB添加作品",()->push("search","")));content.addView(button("手动添加",()->manual()));return;}
        LinearLayout layout=column();body.addView(layout,new FrameLayout.LayoutParams(-1,-1));LinearLayout hero=column();hero.setGravity(Gravity.CENTER_VERTICAL);hero.setPadding(dp(8),dp(20),dp(8),dp(10));
        TextView title=text("",34,PRIMARY);title.setId(R.id.hero_title);title.setTypeface(Typeface.DEFAULT,Typeface.BOLD);title.setMaxLines(2);
        TextView metadata=text("",14,SECONDARY),overview=text("",16,PRIMARY);overview.setMaxLines(2);hero.addView(text("YOUR PRIVATE CINEMA",11,SECONDARY));hero.addView(title);hero.addView(metadata);hero.addView(overview);layout.addView(hero,new LinearLayout.LayoutParams(-1,0,1));
        HorizontalScrollView rail=new HorizontalScrollView(this);rail.setId(R.id.home_rail);rail.setClipToPadding(false);LinearLayout posters=row();posters.setPadding(dp(6),dp(10),dp(6),dp(10));rail.addView(posters);layout.addView(rail,new LinearLayout.LayoutParams(-1,dp(205)));
        Library.Item initial=items.get(0);for(Library.Item item:items)if(item.id().equals(focusedFilm))initial=item;
        final Library.Item selected=initial;
        Done<Library.Item> focus=item->{focusedFilm=item.id();title.setText(item.title());metadata.setText(meta(item)+"  ·  "+statusLabel(item.status()));overview.setText(Json.text(item.film,"overview"));artwork.background(backdrop,item.film);};focus.run(initial);
        for(int i=0;i<Math.min(items.size(),24);i++){Library.Item item=items.get(i);FrameLayout card=poster(item,116);card.setFocusable(true);card.setFocusableInTouchMode(true);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(dp(116),dp(174));lp.setMargins(dp(6),0,dp(6),0);posters.addView(card,lp);
            StateListDrawable outline=new StateListDrawable();outline.addState(new int[]{android.R.attr.state_focused},surface(Color.TRANSPARENT,ACCENT));outline.addState(new int[]{},surface(Color.TRANSPARENT,0));card.setForeground(outline);
            card.setOnFocusChangeListener((view,hasFocus)->{view.animate().scaleX(hasFocus?1.04f:1).scaleY(hasFocus?1.04f:1).setDuration(150).start();if(hasFocus){focus.run(item);rail.smoothScrollTo(Math.max(0,view.getLeft()-dp(170)),0);}});card.setOnClickListener(v->push("film",item.id()));
            if(item.id().equals(selected.id()))card.post(card::requestFocus);
        }
    }
    private void wall(){
        boolean watch=screen.equals("watchlist"),collection=screen.equals("collection");String collectionId=collection?value:"";
        String name=watch?"想看":collection?collectionName(collectionId):"全部收藏";
        LinearLayout layout=column();layout.setPadding(dp(4),dp(8),dp(4),0);body.addView(layout,new FrameLayout.LayoutParams(-1,-1));layout.addView(text(name,28,PRIMARY));
        LinearLayout tools=row();tools.addView(button("搜索",()->input("搜索收藏",query,term->{query=term;show(screen,value);})));if(!watch)tools.addView(button(status.isEmpty()?"全部状态":statusLabel(status),()->choose("观看状态",new String[]{"全部状态","想看","观看中","已看完","暂不观看"},n->{status=new String[]{"","want","watching","watched","dropped"}[n];show(screen,value);})));tools.addView(button(yearFilter==0?"全部年份":String.valueOf(yearFilter),this::chooseYear));tools.addView(button(series.isEmpty()?"全部系列":"切换系列",this::chooseSeries));tools.addView(button("排序",()->choose("排序",new String[]{"最近收藏","最早收藏","标题 A→Z","标题 Z→A","年份新→旧","年份旧→新","评分高→低"},n->{sort=new String[]{"recent","collected_asc","title_asc","title_desc","year_desc","year_asc","rating"}[n];show(screen,value);})));tools.addView(button("添加作品",()->push("search","")));tools.addView(button("媒体源",this::mediaSources));if(collection)tools.addView(button("编辑专题",()->editCollection(value)));layout.addView(tools);
        List<Library.Item> items=library.list(query,watch?"want":status,collectionId,series,sort,yearFilter);layout.addView(text(items.size()+" 部  ·  同系列按序号排列",12,SECONDARY));
        if(items.isEmpty()){layout.addView(text("没有符合条件的作品。",18,SECONDARY));layout.addView(button("清除筛选",()->{query="";status="";series="";yearFilter=0;show(screen,value);}));layout.addView(button("手动添加",this::manual));return;}
        GridView grid=new GridView(this);grid.setId(R.id.library_grid);grid.setFocusableInTouchMode(true);grid.setNumColumns(Math.max(3,getResources().getDisplayMetrics().widthPixels/dp(155)));grid.setHorizontalSpacing(dp(14));grid.setVerticalSpacing(dp(14));grid.setSelector(surface(0x208ab4ff,ACCENT));grid.setDrawSelectorOnTop(true);grid.setStretchMode(GridView.STRETCH_COLUMN_WIDTH);grid.setPadding(dp(4),dp(6),dp(4),dp(6));
        grid.setAdapter(new BaseAdapter(){public int getCount(){return items.size();}public Object getItem(int p){return items.get(p);}public long getItemId(int p){return p;}public View getView(int p,View convert,ViewGroup parent){return gridPoster(items.get(p),convert);}});
        grid.setOnItemClickListener((parent,view,position,id)->{focusedFilm=items.get(position).id();push("film",focusedFilm);});grid.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){public void onItemSelected(android.widget.AdapterView<?> p,View view,int position,long id){focusedFilm=items.get(position).id();}public void onNothingSelected(android.widget.AdapterView<?> p){}});
        layout.addView(grid,new LinearLayout.LayoutParams(-1,0,1));int selected=0;for(int i=0;i<items.size();i++)if(items.get(i).id().equals(focusedFilm))selected=i;grid.setSelection(selected);grid.post(grid::requestFocus);
    }
    private String collectionName(String id){for(JSONObject group:library.collections())if(Json.text(group,"id").equals(id))return Json.text(group,"name");return "专题";}
    private void chooseSeries(){LinkedHashMap<String,String> options=new LinkedHashMap<>();options.put("","全部系列");for(Library.Item item:library.list("","","","","recent"))if(!item.seriesKey().isEmpty())options.put(item.seriesKey(),item.seriesTitle());List<String> keys=new ArrayList<>(options.keySet());choose("按系列筛选",options.values().toArray(new String[0]),n->{series=keys.get(n);show(screen,value);});}
    private void chooseYear(){TreeSet<Integer> years=new TreeSet<>(Collections.reverseOrder());for(Library.Item item:library.list("","","","","recent")){int year=item.film.optInt("year",0);if(year>0)years.add(year);}List<Integer> values=new ArrayList<>();values.add(0);values.addAll(years);String[] labels=new String[values.size()];for(int i=0;i<labels.length;i++)labels[i]=i==0?"全部年份":String.valueOf(values.get(i));choose("按年份筛选",labels,n->{yearFilter=values.get(n);show(screen,value);});}
    private void detail(String id){
        Library.Item item=library.get(id);artwork.background(backdrop,item.film);LinearLayout content=page(item.title(),item.film.optString("mediaType").equals("tv")?"SERIES":"FILM");
        View eyebrow=content.getChildAt(0),heading=content.getChildAt(1);heading.setId(R.id.detail_title);content.removeAllViews();LinearLayout header=row(),copy=column();header.setGravity(Gravity.CENTER_VERTICAL);FrameLayout poster=poster(item,116);LinearLayout.LayoutParams artParams=new LinearLayout.LayoutParams(dp(116),dp(174));artParams.setMargins(0,0,dp(24),dp(12));header.addView(poster,artParams);copy.addView(eyebrow);copy.addView(heading);copy.addView(text(Json.text(item.film,"originalTitle"),14,SECONDARY));copy.addView(text(meta(item)+"  ·  "+statusLabel(item.status()),15,SECONDARY));header.addView(copy,new LinearLayout.LayoutParams(0,-2,1));content.addView(header);
        LinearLayout actions=row();Button primary=button("查看资源",()->{View section=findViewById(R.id.resources_section);if(section!=null)section.requestFocus();});primary.setFocusableInTouchMode(true);StateListDrawable primaryStyle=new StateListDrawable();primaryStyle.addState(new int[]{android.R.attr.state_focused},surface(PRIMARY,ACCENT));primaryStyle.addState(new int[]{},surface(PRIMARY,0));primary.setBackground(primaryStyle);primary.setTextColor(SPACE);actions.addView(primary);actions.addView(button("编辑观影记录",()->editEntry(id)));actions.addView(button("加入专题",()->memberships(id)));actions.addView(button("更多操作",()->choose("作品操作",new String[]{"编辑影视资料","刷新TMDB资料","移除收藏"},n->{if(n==0)editFilm(id);if(n==1)refresh(id);if(n==2)confirm("移除《"+item.title()+"》？","本机的个人记录与资源记录会同时移除。",()->{library.remove(id);onBackPressed();});})));content.addView(actions);primary.post(primary::requestFocus);
        String reason=Json.text(item.entry,"favoriteReason"),review=Json.text(item.entry,"personalReview");if(!reason.isEmpty())content.addView(text("“"+reason+"”",20,PRIMARY));
        content.addView(text("关于这部作品",19,PRIMARY));content.addView(text(Json.text(item.film,"overview").isEmpty()?"暂无简介。":Json.text(item.film,"overview"),16,SECONDARY));if(!review.isEmpty()){content.addView(text("我的短评",19,PRIMARY));content.addView(text(review,16,PRIMARY));}
        try(MediaCatalog catalog=new MediaCatalog(this)){
            List<JSONObject> files=catalog.forFilm(id);
            if(!files.isEmpty()){content.addView(text("播放资源",19,PRIMARY));for(JSONObject file:files){String key=Json.text(file,"key"),label=Json.text(file,"name")+"  "+ResourceName.description(file);content.addView(button((catalog.position(key)>0?"续播  ":"播放  ")+label,()->startActivity(new Intent(this,PlayerActivity.class).putExtra("mediaKey",key))));}}
        }
        content.addView(button("关联夸克 / WebDAV 文件",this::mediaSources));
        TextView resources=text("夸克资源记录",19,PRIMARY);resources.setId(R.id.resources_section);resources.setFocusableInTouchMode(true);resources.setBackground(focusBackground());content.addView(resources);for(JSONObject resource:library.resources(id)){content.addView(button(Json.text(resource,"resourceName")+"  "+Json.text(resource,"qualityLabel")+"  "+Json.text(resource,"versionLabel"),()->resourceActions(id,resource)));}content.addView(button("添加资源记录",()->editResource(id,new JSONObject())));
    }
    private void refresh(String id){Library.Item old=library.get(id);if(!Json.text(old.film,"metadataSource").equals("tmdb")){toast("手动作品没有可刷新的TMDB资料。");return;}job("刷新资料…",()->library.refresh(id,artwork.cacheMetadata(tmdb().candidate(Json.text(old.film,"externalId"),Json.text(old.film,"mediaType")),old.film)),item->{show("film",id);toast("资料已刷新，个人记录保留。");});}
    private void editEntry(String id){Library.Item item=library.get(id);String[] states={"want","watching","watched","dropped"};
        LinearLayout form=column();Button state=button(statusLabel(item.status()),()->{});final int[] choice={0};for(int i=0;i<states.length;i++)if(states[i].equals(item.status()))choice[0]=i;state.setOnClickListener(v->{choice[0]=(choice[0]+1)%states.length;state.setText(statusLabel(states[choice[0]]));});form.addView(text("观影状态（确认键切换）",13,SECONDARY));form.addView(state);
        EditText rating=field(form,"个人评分（0–10，留空为未评分）",item.entry.isNull("personalRating")?"":String.valueOf(item.entry.optDouble("personalRating")),false);rating.setInputType(InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL);
        EditText reason=field(form,"收藏理由",Json.text(item.entry,"favoriteReason"),true),review=field(form,"个人短评",Json.text(item.entry,"personalReview"),true);
        formDialog("观影记录",form,()->{JSONObject patch=new JSONObject();Json.put(patch,"watchStatus",states[choice[0]]);String number=rating.getText().toString().trim();Json.put(patch,"personalRating",number.isEmpty()?null:Double.valueOf(number));Json.put(patch,"favoriteReason",reason.getText().toString());Json.put(patch,"personalReview",review.getText().toString());library.updateEntry(id,patch);show("film",id);});
    }
    private JSONObject manualSeries(JSONObject old,String title,String order){
        title=title.trim();if(title.isEmpty())return null;Integer number=order.trim().isEmpty()?null:Integer.valueOf(order.trim());if(number!=null&&(number<0||number>9999))throw new IllegalArgumentException("系列序号范围是0至9999。");
        String key="manual:"+title.toLowerCase(java.util.Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]","");JSONObject previous=old.optJSONObject("series");if(previous!=null&&Json.text(previous,"title").equalsIgnoreCase(title))key=Json.text(previous,"key");
        else for(Library.Item item:library.list("","","","","recent"))if(item.seriesTitle().equalsIgnoreCase(title)){key=item.seriesKey();break;}
        JSONObject result=TmdbClient.series(key,title,number);Json.put(result,"customOrder",true);return result;
    }
    private void manual(){editFilm("");}
    private void editFilm(String id){
        JSONObject old=id.isEmpty()?new JSONObject():library.get(id).film;LinearLayout form=column();EditText title=field(form,"片名",Json.text(old,"title"),false),original=field(form,"原名",Json.text(old,"originalTitle"),false),year=field(form,"年份",old.isNull("year")?"":old.has("year")?String.valueOf(old.optInt("year")):"",false),overview=field(form,"简介",Json.text(old,"overview"),true);
        JSONObject series=old.optJSONObject("series");EditText seriesTitle=field(form,"系列名称",series==null?"":Json.text(series,"title"),false),order=field(form,"系列序号",series==null||series.isNull("order")?"":String.valueOf(series.optInt("order")),false);
        final String[] type={id.isEmpty()?"movie":Json.text(old,"mediaType")};if(id.isEmpty()){Button switchType=button("电影",()->{});switchType.setOnClickListener(v->{type[0]=type[0].equals("movie")?"tv":"movie";switchType.setText(type[0].equals("tv")?"剧集":"电影");});form.addView(switchType);}
        formDialog(id.isEmpty()?"手动添加":"编辑影视资料",form,()->{
            JSONObject patch=new JSONObject();Json.put(patch,"title",title.getText().toString());Json.put(patch,"originalTitle",original.getText().toString());String number=year.getText().toString().trim();Integer y=number.isEmpty()?null:Integer.valueOf(number);if(y!=null&&(y<1800||y>2200))throw new IllegalArgumentException("年份范围是1800至2200。");Json.put(patch,"year",y);Json.put(patch,"overview",overview.getText().toString());
            String enteredTitle=seriesTitle.getText().toString(),enteredOrder=order.getText().toString();
            if(series==null||!enteredTitle.equals(Json.text(series,"title"))||!enteredOrder.equals(series.isNull("order")?"":String.valueOf(series.optInt("order"))))Json.put(patch,"series",manualSeries(old,enteredTitle,enteredOrder));
            if(id.isEmpty()){Json.put(patch,"mediaType",type[0]);Json.put(patch,"externalId","");Library.Item item=library.saveCandidate(patch);push("film",item.id());}else{library.editFilm(id,patch);show("film",id);}
        });
    }
    private void collections(){LinearLayout content=page("自定义专题","CURATED EDITIONS");content.addView(button("创建专题",()->editCollection("")));List<JSONObject> groups=library.collections();if(groups.isEmpty())content.addView(text("把值得放在一起的作品，编成自己的专题。",18,SECONDARY));for(JSONObject group:groups){String id=Json.text(group,"id");content.addView(button(Json.text(group,"name")+"  ·  "+library.list("","",id,"","recent").size()+" 部",()->push("collection",id)));content.addView(text(Json.text(group,"description"),14,SECONDARY));}}
    private void editCollection(String id){JSONObject group=new JSONObject();for(JSONObject item:library.collections())if(Json.text(item,"id").equals(id))group=item;LinearLayout form=column();EditText name=field(form,"名称",Json.text(group,"name"),false),description=field(form,"介绍",Json.text(group,"description"),true);final AlertDialog[] editor={null};if(!id.isEmpty())form.addView(button("删除专题",()->confirm("删除专题？","专题里的作品会保留。",()->{library.removeCollection(id);if(editor[0]!=null)editor[0].dismiss();top("collections");})));
        editor[0]=formDialog(id.isEmpty()?"创建专题":"编辑专题",form,()->{library.saveCollection(id,name.getText().toString(),description.getText().toString());show(screen,value);});}
    private void memberships(String id){List<JSONObject> groups=library.collections();if(groups.isEmpty()){toast("请先在专题页面创建专题。");return;}String[] names=new String[groups.size()];boolean[] checked=new boolean[groups.size()];Set<String> selection=new HashSet<>(library.memberships(id));for(int i=0;i<groups.size();i++){names[i]=Json.text(groups.get(i),"name");checked[i]=selection.contains(Json.text(groups.get(i),"id"));}
        new AlertDialog.Builder(this).setTitle("加入专题").setMultiChoiceItems(names,checked,(dialog,n,on)->{String key=Json.text(groups.get(n),"id");if(on)selection.add(key);else selection.remove(key);}).setPositiveButton("保存",(dialog,n)->{library.setMemberships(id,selection);show("film",id);}).setNegativeButton("取消",null).show();}
    private void resourceActions(String filmId,JSONObject resource){choose("资源记录",new String[]{"查看与编辑","打开分享页面","删除记录"},n->{if(n==0)editResource(filmId,resource);if(n==1){try{Uri uri=Uri.parse(Json.text(resource,"shareUrl"));if(!"https".equals(uri.getScheme())&&!"http".equals(uri.getScheme()))throw new IllegalArgumentException();startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception error){toast("电视上没有可用浏览器，或分享地址无效。");}}if(n==2)confirm("删除资源记录？","作品会保留。",()->{library.removeResource(Json.text(resource,"id"));show("film",filmId);});});}
    private void editResource(String filmId,JSONObject resource){LinearLayout form=column();String[] keys={"resourceName","shareUrl","accessCode","qualityLabel","versionLabel","subtitleLabel","audioLabel","notes"},labels={"资源名称","夸克分享链接","提取码","画质","版本 / 编码","字幕","音轨","备注"};EditText[] fields=new EditText[keys.length];for(int i=0;i<keys.length;i++)fields[i]=field(form,labels[i],Json.text(resource,keys[i]),i==7);formDialog("夸克资源记录",form,()->{JSONObject data=Json.copy(resource);for(int i=0;i<keys.length;i++)Json.put(data,keys[i],fields[i].getText().toString());library.saveResource(filmId,data);show("film",filmId);});}
    private void search(){
        LinearLayout content=page("发现下一部收藏","TMDB");EditText input=new EditText(this);input.setId(R.id.search_query);input.setSingleLine(true);input.setHint("输入片名或剧名");input.setText(searchQuery);input.setTextColor(PRIMARY);content.addView(input,new LinearLayout.LayoutParams(-1,dp(52)));
        LinearLayout actions=row();actions.addView(button(searchType.equals("tv")?"类型：剧集":"类型：电影",()->{searchQuery=input.getText().toString();searchType=searchType.equals("tv")?"movie":"tv";searchResults.clear();show("search","");}));
        Button submit=button("搜索",()->{searchQuery=input.getText().toString();job("搜索TMDB…",()->tmdb().search(searchQuery,searchType),result->{searchResults=result;show("search","");if(result.isEmpty())toast("没有找到匹配资料，可调整片名或手动添加。");});});submit.setId(R.id.search_submit);actions.addView(submit);actions.addView(button("手动添加",this::manual));content.addView(actions);
        if(!secrets.exists())content.addView(button("先配置TMDB API Key",()->top("settings")));
        for(JSONObject item:searchResults){LinearLayout row=row();ImageView image=new ImageView(this);image.setScaleType(ImageView.ScaleType.CENTER_CROP);row.addView(image,new LinearLayout.LayoutParams(dp(54),dp(80)));artwork.preview(image,Json.text(item,"posterUrl"),54,80);Button select=button(Json.text(item,"title")+"  "+(item.isNull("year")?"":item.optInt("year"))+(searchType.equals("tv")?"  ·  选择季":"  ·  查看资料"),()->{
                String id=Json.text(item,"externalId");if(searchType.equals("tv"))job("读取季列表…",()->tmdb().seasonList(id),data->{seasonData=data;seasonId=id;selectedSeasons.clear();focusedSeason=-1;push("seasons",id);});else fetchCandidate(id,"movie");
            });row.addView(select,new LinearLayout.LayoutParams(0,dp(80),1));content.addView(row);
        }
    }
    private void fetchCandidate(String id,String type){job("读取影视资料…",()->tmdb().candidate(id,type),data->{pendingCandidate=data;push("candidate",id);});}
    private void candidate(){if(pendingCandidate==null){top("home");return;}LinearLayout content=page(Json.text(pendingCandidate,"title"),"确认收藏");content.addView(text(Json.text(pendingCandidate,"overview").isEmpty()?"暂无简介。":Json.text(pendingCandidate,"overview"),16,SECONDARY));content.addView(button("确认导入并缓存图片",()->{JSONObject chosen=Json.copy(pendingCandidate);job("导入收藏…",()->library.saveCandidate(artwork.cacheMetadata(chosen,null)),item->{show("film",item.id());toast("已加入收藏。");});}));}
    private void seasons(){
        if(seasonData==null){top("home");return;}LinearLayout content=page(Json.text(seasonData,"name"),"选择季");
        LinearLayout actions=row();Button importSelected=button("导入所选季",()->importSeasons());actions.addView(importSelected);actions.addView(button("收藏整剧",()->fetchCandidate(seasonId,"tv")));actions.addView(button("手动补季",this::manual));content.addView(actions);
        List<JSONObject> rows=new ArrayList<>();Set<Integer> seen=new HashSet<>();JSONArray source=Json.array(seasonData,"seasons");for(int i=0;i<source.length();i++){JSONObject item=source.optJSONObject(i);if(item==null)continue;int n=item.optInt("season_number",-1);if(n>=0&&n<=9999&&seen.add(n))rows.add(item);}Collections.sort(rows,(a,b)->Integer.compare(a.optInt("season_number"),b.optInt("season_number")));
        Set<String> collected=new HashSet<>();for(Library.Item item:library.list("","","","","recent"))if(Json.text(item.film,"mediaType").equals("tv"))collected.add(Json.text(item.film,"externalId"));
        boolean focusAssigned=false;
        for(JSONObject item:rows){int n=item.optInt("season_number");String label=n==0?"特别篇":"第"+n+"季",external=seasonId+":season:"+n;boolean exists=collected.contains(external);LinearLayout line=row();
            Button toggle=button(exists?"已收藏":selectedSeasons.contains(n)?"✓ 已选":"选择",()->{if(selectedSeasons.contains(n))selectedSeasons.remove(n);else selectedSeasons.add(n);focusedSeason=n;show("seasons",seasonId);});toggle.setEnabled(!exists);line.addView(toggle,new LinearLayout.LayoutParams(dp(90),dp(48)));
            if(!exists&&((focusedSeason<0&&!focusAssigned)||focusedSeason==n)){toggle.setFocusableInTouchMode(true);toggle.post(toggle::requestFocus);focusAssigned=true;}
            line.addView(button(label+"  "+Json.text(item,"air_date")+"  ·  "+item.optInt("episode_count")+" 集",()->fetchCandidate(external,"tv")),new LinearLayout.LayoutParams(0,dp(48),1));content.addView(line);content.addView(text(Json.text(item,"overview").isEmpty()?"本季暂无简介。":Json.text(item,"overview"),13,SECONDARY));
        }
        if(!focusAssigned){importSelected.setFocusableInTouchMode(true);importSelected.post(importSelected::requestFocus);}
    }
    private void importSeasons(){
        if(selectedSeasons.isEmpty()){toast("请先选择要导入的季。");return;}List<Integer> requested=new ArrayList<>(selectedSeasons);String id=seasonId;
        job("批量导入…",()->{List<Integer> completed=new ArrayList<>();String failure="";for(int n:requested){try{library.saveCandidate(artwork.cacheMetadata(tmdb().candidate(id+":season:"+n,"tv"),null));completed.add(n);}catch(Exception error){failure=message(error);break;}}return new Batch(completed,failure);},batch->{selectedSeasons.removeAll(batch.completed);show("seasons",id);toast("已处理 "+batch.completed.size()+" 季"+(batch.failure.isEmpty()?"。":"；"+batch.failure+" 已完成项保留，可重试剩余季。"));});
    }
    private static final class Batch{final List<Integer> completed;final String failure;Batch(List<Integer> completed,String failure){this.completed=completed;this.failure=failure;}}
    private void mediaSources(){startActivity(new Intent(this,MediaBrowserActivity.class));}
    private void settings(){
        LinearLayout content=page("放映室设置","THE STUDIO");content.addView(text("电视本地收藏 · 独立管理",18,PRIMARY));content.addView(text("Android "+android.os.Build.VERSION.RELEASE+" / API "+android.os.Build.VERSION.SDK_INT+"  ·  My Cinema TV "+BuildConfig.VERSION_NAME,14,SECONDARY));
        content.addView(button(secrets.exists()?"TMDB配置：已保存 · 重新配置":"配置TMDB API Key",this::configureKey));if(secrets.exists())content.addView(button("清除TMDB配置",()->confirm("清除TMDB配置？","本地收藏和图片会保留。",()->{secrets.clear();show("settings","");})));
        content.addView(button("资料语言："+(language.equals("zh-CN")?"简体中文":"English"),()->{language=language.equals("zh-CN")?"en-US":"zh-CN";getPreferences(0).edit().putString("language",language).apply();show("settings","");}));
        content.addView(button("媒体源 · 夸克 / WebDAV",this::mediaSources));
        content.addView(text("收藏与备份",19,PRIMARY));content.addView(button("创建本机备份",()->job("备份收藏…",()->{writeBackup("collection-backup.json",library.snapshot());return true;},done->toast("已保存本机收藏备份；不包含TMDB凭据。"))));
        content.addView(button("恢复上次本机备份",()->confirm("恢复收藏备份？","当前收藏会先另存为恢复前备份，TMDB配置保留。",()->job("恢复收藏…",()->{AtomicFile file=new AtomicFile(new File(getFilesDir(),"collection-backup.json"));if(!file.getBaseFile().isFile())throw new IllegalArgumentException("还没有创建本机备份。");JSONObject data=Json.object(new String(file.readFully(),StandardCharsets.UTF_8));writeBackup("before-restore.json",library.snapshot());library.restore(data);return true;},done->{show("settings","");toast("收藏已恢复。");}))));
        content.addView(text("使用遥控器方向键浏览，确认键选择，返回键退回上一页。收藏和图片保存在电视本机；卸载会清除应用数据。",14,SECONDARY));
        content.addView(text("影视资料与图片来自TMDB。本产品未获得TMDB认可或认证。",12,SECONDARY));
    }
    private void configureKey(){LinearLayout form=column();EditText field=field(form,"TMDB API Key / Read Access Token","",false);field.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);form.addView(text("验证成功后由Android Keystore保护保存。",13,SECONDARY));formDialog("配置TMDB",form,()->{String key=field.getText().toString().trim();if(key.isEmpty())throw new IllegalArgumentException("请输入TMDB凭据。");job("验证TMDB…",()->{TmdbClient.verifyKey(key,language);secrets.save(key);return true;},done->{show("settings","");toast("TMDB配置已验证并安全保存。");});});}
    private void writeBackup(String name,JSONObject data) throws Exception {AtomicFile file=new AtomicFile(new File(getFilesDir(),name));FileOutputStream output=null;try{output=file.startWrite();output.write(data.toString().getBytes(StandardCharsets.UTF_8));file.finishWrite(output);}catch(Exception error){if(output!=null)file.failWrite(output);throw error;}}
    private EditText field(LinearLayout form,String label,String initial,boolean multiple){form.addView(text(label,13,SECONDARY));EditText input=new EditText(this);input.setText(initial);input.setTextColor(PRIMARY);input.setTextSize(16);input.setSingleLine(!multiple);if(multiple)input.setMaxLines(3);form.addView(input,new LinearLayout.LayoutParams(-1,-2));return input;}
    private AlertDialog formDialog(String title,LinearLayout form,Runnable save){ScrollView scroll=new ScrollView(this);scroll.setPadding(dp(20),0,dp(20),0);scroll.addView(form);AlertDialog dialog=new AlertDialog.Builder(this).setTitle(title).setView(scroll).setPositiveButton("保存",null).setNegativeButton("取消",null).create();dialog.setOnShowListener(ignored->{dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{try{save.run();dialog.dismiss();}catch(Exception error){toast(message(error));}});dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);});dialog.show();return dialog;}
    private void confirm(String title,String description,Runnable action){new AlertDialog.Builder(this).setTitle(title).setMessage(description).setNegativeButton("取消",null).setPositiveButton("确认",(dialog,n)->{try{action.run();}catch(Exception error){toast(message(error));}}).show();}
    private void input(String title,String initial,Done<String> done){LinearLayout form=column();EditText input=field(form,title,initial,false);formDialog(title,form,()->done.run(input.getText().toString()));}
    private void choose(String title,String[] labels,Done<Integer> done){new AlertDialog.Builder(this).setTitle(title).setItems(labels,(dialog,n)->done.run(n)).setNegativeButton("取消",null).show();}
}
