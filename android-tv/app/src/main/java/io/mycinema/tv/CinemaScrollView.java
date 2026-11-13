package io.mycinema.tv;
import android.content.Context;
import android.widget.ScrollView;
/** onScrollChanged is available on API21, unlike the API23 scroll-listener setter. */
final class CinemaScrollView extends ScrollView {
    interface Scroll {void changed(int top);}
    private Scroll listener;
    CinemaScrollView(Context context){super(context);}
    void onScroll(Scroll listener){this.listener=listener;}
    @Override protected void onScrollChanged(int left,int top,int oldLeft,int oldTop){super.onScrollChanged(left,top,oldLeft,oldTop);if(listener!=null)listener.changed(top);}
}
