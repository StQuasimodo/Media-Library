package io.mycinema.tv;

/** Never confirm an optimistic seek clock, or silently keep playing after missing its window. */
final class PausedRestore {
    enum Outcome {WAIT,READY,RETRY,FAILED}
    private final long target;private int initialOutput;
    private long candidateAt=-1,began=-1,attemptAt=-1;private int candidateOutput,retries;private boolean failed;
    PausedRestore(long target,int initialOutput){this.target=target;this.initialOutput=initialOutput;}
    Outcome observe(long time,int output,long now){
        if(failed)return Outcome.FAILED;
        if(began<0||now<began){began=now;attemptAt=now;candidateAt=-1;}
        if(now-began>=20000){failed=true;return Outcome.FAILED;}
        boolean newOutput=output>Math.max(0,initialOutput);
        if(time>=0&&Math.abs(time-target)<=1000&&newOutput){
            if(candidateAt<0||now<candidateAt){candidateAt=now;candidateOutput=output;return Outcome.WAIT;}
            if(now-candidateAt>=250&&output>candidateOutput)return Outcome.READY;
        }else candidateAt=-1;
        if(time>=0&&time>target&&time-target>1000&&newOutput&&now-attemptAt>=1500){
            if(retries>=2){failed=true;return Outcome.FAILED;}
            retries++;attemptAt=now;initialOutput=output;candidateAt=-1;return Outcome.RETRY;
        }
        return Outcome.WAIT;
    }
    boolean ready(long time,int output,long now){return observe(time,output,now)==Outcome.READY;}
}
