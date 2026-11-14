package io.mycinema.tv;
import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ObjectAnimator;
import android.content.Context;
import android.provider.Settings;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.widget.HorizontalScrollView;
/** API21 page/focus motion and interruptible rail scrolling, respecting the system animation switch. */
final class UiMotion {
    static boolean enabled(Context context){return Settings.Global.getFloat(context.getContentResolver(),Settings.Global.ANIMATOR_DURATION_SCALE,1f)>0;}
    static void enter(View view){view.animate().cancel();if(!enabled(view.getContext())){view.setAlpha(1);view.setTranslationY(0);return;}view.setAlpha(0);view.setTranslationY(RemoteUi.dp(view.getContext(),10));view.animate().alpha(1).translationY(0).setDuration(320).setInterpolator(new DecelerateInterpolator(1.6f)).start();}
    static void focus(View view,boolean focused){if(view==null)return;view.animate().cancel();float scale=focused?1.025f:1;if(enabled(view.getContext()))view.animate().scaleX(scale).scaleY(scale).setDuration(180).setInterpolator(new DecelerateInterpolator()).start();else{view.setScaleX(1);view.setScaleY(1);}}

    /** Retarget from the current position; API21 smoothScrollTo snaps when
     * repeated within its 250ms animated-scroll gap (common with a held DPAD). */
    static final class FocusScroll implements View.OnAttachStateChangeListener {
        private final HorizontalScrollView rail;
        private ObjectAnimator animation;
        FocusScroll(HorizontalScrollView rail){this.rail=rail;rail.addOnAttachStateChangeListener(this);}
        void to(int left){
            if(animation!=null)animation.cancel();
            View content=rail.getChildAt(0);
            int max=content==null?0:Math.max(0,content.getWidth()-rail.getWidth()+rail.getPaddingLeft()+rail.getPaddingRight());
            int target=Math.max(0,Math.min(max,left));
            if(!enabled(rail.getContext())){rail.scrollTo(target,0);return;}
            if(target==rail.getScrollX())return;
            ObjectAnimator next=ObjectAnimator.ofInt(rail,"scrollX",rail.getScrollX(),target);
            animation=next;
            next.setDuration(220);
            next.setInterpolator(new DecelerateInterpolator(1.6f));
            next.addListener(new AnimatorListenerAdapter(){@Override public void onAnimationEnd(Animator ended){if(animation==ended)animation=null;}});
            next.start();
        }
        @Override public void onViewAttachedToWindow(View view){}
        @Override public void onViewDetachedFromWindow(View view){if(animation!=null)animation.cancel();}
    }
}
