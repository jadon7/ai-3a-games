"""Hand-drawn chasing patterns for four castings. A painted bevel and a tangent-space
normal map retain the fine toolwork at game scale."""
import io
import re
import math

import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import distance_transform_edt, gaussian_filter

def painted_panels(metal_tile):
    W,H=512,768
    atlas=Image.new('RGB',(W*2,H*2));normals=Image.new('RGB',atlas.size)
    base=Image.open(io.BytesIO(metal_tile)).convert('RGB')
    def outline(path):
        toks=re.findall(r'[MLCQZ]|-?\d+(?:\.\d+)?',path)
        ptr=0;points=[]
        def v():
            nonlocal ptr
            a=np.array([float(toks[ptr]),float(toks[ptr+1])]);ptr+=2
            return a
        while ptr<len(toks):
            cmd=toks[ptr];ptr+=1
            if cmd=='Z':break
            if cmd in 'ML':points.append(v())
            if cmd in 'CQ':
                pts=[points[-1],v(),v()]
                if cmd=='C':pts.append(v())
                for t in np.linspace(0,1,16)[1:]:
                    p=np.array(pts)
                    while len(p)>1:p=(1-t)*p[:-1]+t*p[1:]
                    points.append(p[0])
        im=Image.new('L',(W,H))
        ImageDraw.Draw(im).polygon([tuple(q*[W/1000,H/1000]) for q in points],fill=255)
        return np.array(im)>0
    def contours(path,mirror=False):
        mask=outline(path)
        return mask|mask[:,::-1] if mirror else mask
    designs=[
        # Blade: a hooked palmette shield, counter-scrolls and split nibs.
        [('M 42 906 C 212 909 243 830 209 822 C 161 804 207 783 260 777 C 313 756 258 753 224 759 C 286 707 419 729 444 682 C 461 641 505 646 530 636 C 489 655 514 671 551 669 C 614 675 643 644 672 625 C 660 657 714 663 761 625 C 792 598 816 591 848 583 C 812 617 843 630 809 653 C 746 684 788 700 720 724 C 680 740 636 732 601 755 C 561 783 604 795 547 822 C 502 843 421 831 377 868 C 334 903 243 916 160 912 Z',False),
         ('M 89 985 C 206 950 303 966 368 925 C 402 899 434 901 468 906 C 513 911 546 900 575 876 C 578 907 548 927 512 937 C 492 940 475 938 461 949 C 435 974 389 985 341 982 C 293 973 250 983 209 992 Z',False),
         ('M 682 803 C 733 783 718 765 740 751 C 774 735 808 747 841 719 C 863 701 845 689 819 686 C 871 666 929 674 922 700 C 912 729 889 745 856 758 C 816 773 805 811 742 825 C 773 797 747 791 718 807 Z',False),
         ('M 62 720 C 102 707 103 691 82 684 C 124 678 172 687 185 668 C 200 651 179 639 164 643 C 183 619 216 627 217 650 C 220 680 191 693 161 701 C 136 708 129 719 112 732 Z',False)],
        # Bell: broad shield divisions and sickle inlay, wrapping a single cast skirt.
        [('M 10 981 L 10 82 C 45 164 59 203 127 224 C 176 236 199 214 187 195 C 175 172 136 187 146 202 C 104 185 120 152 154 145 C 210 129 232 194 288 210 C 347 226 373 201 398 168 C 377 254 321 296 257 290 C 192 281 175 302 170 364 L 133 753 C 127 818 85 859 86 927 L 85 981 Z',False),
         ('M 187 983 C 236 912 244 866 240 793 L 227 524 C 227 472 247 440 284 426 C 337 408 351 385 361 343 C 378 394 365 433 338 455 C 304 481 309 524 314 552 L 327 802 C 330 868 295 929 272 983 Z',False),
         ('M 997 32 L 993 988 L 941 988 C 957 890 919 848 906 775 L 858 501 C 849 454 832 426 787 421 C 724 410 697 382 674 328 C 719 365 751 354 790 367 C 847 388 870 347 861 303 C 857 270 834 252 808 256 C 829 223 872 229 901 271 C 943 335 949 245 956 200 Z',False)],
        # Sabaton: symmetric seam engraving with a central tongue.
        [('M 34 899 C 132 845 185 820 214 769 L 306 593 C 317 653 289 728 261 780 C 226 837 236 865 292 856 L 493 783 L 496 815 L 289 909 C 235 941 170 935 147 905 L 56 958 Z',True),
         ('M 58 48 L 184 129 L 270 110 C 291 178 333 221 369 248 L 448 285 L 497 234 L 495 330 C 431 303 389 299 351 324 L 296 356 C 328 303 319 273 287 236 L 214 171 L 173 188 Z',True),
         ('M 489 387 C 479 464 445 497 383 527 C 442 549 482 604 500 660 C 517 602 550 552 604 524 C 547 493 517 468 505 390 Z',False)],
        # Side armour: an incised cheek around its eye, with a sweeping lip.
        [('M 138 14 C 266 104 271 178 246 226 C 174 369 160 456 197 544 C 233 633 323 690 388 724 C 478 771 509 834 507 932 C 475 873 453 840 381 815 C 285 782 237 755 202 691 C 167 627 147 592 98 573 C 131 562 141 546 124 495 C 63 331 158 252 173 164 C 183 108 167 67 138 14 Z',False),
         ('M 455 47 C 469 128 510 131 548 153 C 630 201 660 247 656 316 C 655 369 629 409 607 436 C 632 368 615 301 581 267 C 531 219 472 230 427 288 C 373 357 362 454 393 532 C 420 605 505 641 551 670 C 615 716 654 788 668 850 C 633 806 596 787 547 764 C 442 708 335 649 296 541 C 249 398 295 304 362 229 C 405 175 450 155 455 47 Z',False),
         ('M 915 766 C 876 672 794 679 773 601 C 757 547 793 502 830 490 C 793 540 832 571 871 571 C 847 597 851 635 883 660 C 922 692 931 722 915 766 Z',False)]
    ]
    for ci,group in enumerate(designs):
        pigments=np.asarray(base.resize((W,H)),dtype=float)
        height=np.zeros((H,W))
        for path,mirror in group:
            m=contours(path,mirror)
            signed=distance_transform_edt(m)-distance_transform_edt(~m)
            # Burnished edges over a darker channel chased into the surrounding metal.
            ridge=np.clip((signed+.3)/3.9,0,1)
            ridge=ridge*ridge*(3-2*ridge)
            cut=np.exp(-((signed+2.4)/1.8)**2)
            height+=ridge*(2.5 if ci in (0,3) else 1.7)-cut*.64
            gilt=np.exp(-((signed-2.6)/2.80)**2)*.86+np.exp(-((signed-5.8)/3.05)**2)*.22
            face=np.clip(signed/5,0,1)
            metal=np.array([168,154,108]) if ci in (0,3) else np.array([150,140,102])
            pigments=pigments*(1-np.minimum(.94,gilt)[:,:,None])+metal*np.minimum(.94,gilt)[:,:,None]
            pigments+=face[:,:,None]*([16,8,-2] if ci==0 else [5,3,-1])
            pigments-=cut[:,:,None]*[19,19,12]
        # Additional fine engraver's cuts inside the shield (intaglio).
        if ci==0:
            for path in ['M 229 877 C 330 854 322 814 387 792 C 426 778 454 778 476 750 C 468 800 429 807 395 823 C 349 845 337 864 287 874 Z',
                         'M 385 764 C 424 732 490 744 536 705 C 530 741 505 762 478 767 C 429 772 411 788 383 790 Z',
                         'M 577 715 C 603 695 608 680 606 668 C 631 672 643 691 625 707 C 612 720 593 721 577 730 Z']:
                m=outline(path);sdf=distance_transform_edt(m)-distance_transform_edt(~m)
                etch=np.clip((sdf+.5)/2.0,0,1)
                height-=etch*2.0;pigments-=etch[:,:,None]*[23,19,11]
        gy,gx=np.gradient(gaussian_filter(height,.68))
        light=np.clip(-gx*.60-gy*.75,-1,1)
        pigments+=light[:,:,None]*[23,22,16]
        n=np.stack([-gx*1.2,gy*1.2,np.ones_like(gx)],axis=-1)
        n/=np.linalg.norm(n,axis=-1)[:,:,None]
        origin=(W*(ci%2),H*(ci//2))
        atlas.paste(Image.fromarray(np.uint8(np.clip(pigments,0,255))),origin)
        normals.paste(Image.fromarray(np.uint8(np.clip((n*.5+.5)*255,0,255))),origin)
    result=[]
    for im in (atlas,normals):
        b=io.BytesIO();im.save(b,format='JPEG',quality=93,subsampling=0)
        result.append(b.getvalue())
    return result

def panel_uv(index,t,v):
    return ((index%2+.002+.996*t)/2,(index//2+.002+.996*v)/2)
