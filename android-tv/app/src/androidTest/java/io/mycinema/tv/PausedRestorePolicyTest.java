package io.mycinema.tv;

import java.util.*;

/** Host/API22: restore cannot pause on the requested clock before actual output has settled. */
public final class PausedRestorePolicyTest {
    private static void check(List<String> checks,boolean ok,String label){if(!ok)throw new AssertionError(label);checks.add(label);}
    public static List<String> run(){
        List<String> checks=new ArrayList<>();PausedRestore restore=new PausedRestore(40000,0);
        check(checks,!restore.ready(40000,0,0)&&!restore.ready(40000,0,1000),"optimistic target clock with zero output cannot finish paused restore");
        check(checks,!restore.ready(32299,4,1100),"actual keyframe clock eight seconds early cannot finish paused restore");
        check(checks,!restore.ready(39700,5,1200),"first displayed target-area frame starts a settling interval");
        check(checks,!restore.ready(39800,6,1400),"a fresh frame within 200ms is insufficient to pause");
        check(checks,!restore.ready(39800,5,1500),"elapsed time without additional output cannot confirm restore");
        check(checks,restore.ready(40000,7,1600),"stable target-area clock and further output permit pausing");
        restore=new PausedRestore(40000,10);check(checks,!restore.ready(40000,10,0)&&!restore.ready(40000,10,300),"output from before the restore request cannot satisfy readiness");
        restore=new PausedRestore(40000,0);restore.ready(39700,1,1000);restore.ready(32299,5,1300);check(checks,!restore.ready(39700,6,1500),"clock leaving the target area discards earlier stability evidence");
        check(checks,restore.ready(40000,8,1800),"new stable interval after a clock jump can complete restore");
        restore=new PausedRestore(40000,0);restore.ready(40000,1,1000);check(checks,!restore.ready(40000,2,900),"backward elapsed time restarts the settling interval");
        return checks;
    }
    public static void main(String[] args){List<String> checks=run();for(String check:checks)System.out.println("PASS "+check);System.out.println("Passed "+checks.size()+" paused restore checks");}
}
