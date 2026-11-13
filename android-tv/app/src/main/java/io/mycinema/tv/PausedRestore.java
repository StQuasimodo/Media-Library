package io.mycinema.tv;

/** A seek's optimistic clock is insufficient proof that a paused restore has reached its frame. */
final class PausedRestore {
    private final long target;private final int initialOutput;
    private long candidateAt=-1;private int candidateOutput;
    PausedRestore(long target,int initialOutput){this.target=target;this.initialOutput=initialOutput;}
    boolean ready(long time,int output,long now){
        if(time<0||Math.abs(time-target)>1000||output<=Math.max(0,initialOutput)){
            candidateAt=-1;return false;
        }
        if(candidateAt<0||now<candidateAt){candidateAt=now;candidateOutput=output;return false;}
        return now-candidateAt>=250&&output>candidateOutput;
    }
}
