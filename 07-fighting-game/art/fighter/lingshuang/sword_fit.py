"""sword_profile.py 之后跑一次：刀身的上下沿用多项式拟合平滑（设定图边上有毛刺），刀尖段（切先）的下沿单独拟合。原始值留在 top_raw/bot_raw。"""
import numpy as np
p=dict(np.load('work/sword_profile.npz')); t=p.get('top_raw',p['top']).astype(float); b=p.get('bot_raw',p['bot']).astype(float)
x=np.arange(len(t))
s=(x>=830)&(x<=2470); ct=np.polyfit(x[s],t[s],3); cb=np.polyfit(x[s],b[s],3)
s2=(x>=2300)&(x<=2600); ct2=np.polyfit(x[s2],t[s2],1)
k=(x>2460)&(x<=2604); ck=np.polyfit(x[k],b[k],2)
tn=t.copy(); bn=b.copy(); r=(x>=830)&(x<=p['x1'])
tn[r]=np.polyval(ct,x[r]); bn[r]=np.polyval(cb,x[r])
r2=(x>2300)&(x<=p['x1']); w=np.clip((x[r2]-2300)/100,0,1); tn[r2]=(1-w)*tn[r2]+w*np.polyval(ct2,x[r2])
bk=(x>2470)&(x<=p['x1']); bn[bk]=np.minimum(np.polyval(ck,x[bk]), np.polyval(cb,x[bk]))
x1=int(p['x1']); bn[x1]=tn[x1]+1
p['top_raw']=t; p['bot_raw']=b; p['top']=tn; p['bot']=bn; np.savez('work/sword_profile.npz',**p); print('fitted')
