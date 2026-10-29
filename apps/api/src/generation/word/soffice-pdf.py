# Word 转 PDF：用 LibreOffice 打开 .docx，排版后更新目录页码，再导出 PDF。
# 直接 --convert-to 时目录只有条目没有页码，所以用这个脚本。由 pdf.ts 用 LibreOffice 自带的 Python 调用：
#   python soffice-pdf.py <soffice 可执行文件> <输入.docx> <输出.pdf> <配置目录 URL>
import os
import subprocess
import sys
import time

import uno
from com.sun.star.beans import PropertyValue


def prop(name, value):
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p


def main():
    soffice, src, dst, profile = sys.argv[1:5]
    pipe = 'genyun_' + str(os.getpid())
    proc = subprocess.Popen([
        soffice, '-env:UserInstallation=' + profile, '--headless', '--norestore', '--invisible',
        '--accept=pipe,name=' + pipe + ';urp;',
    ])
    try:
        resolver = uno.getComponentContext().ServiceManager.createInstanceWithContext(
            'com.sun.star.bridge.UnoUrlResolver', uno.getComponentContext())
        ctx = None
        for _ in range(240):
            try:
                ctx = resolver.resolve('uno:pipe,name=' + pipe + ';urp;StarOffice.ComponentContext')
                break
            except Exception:
                time.sleep(0.25)
        if ctx is None:
            raise RuntimeError('LibreOffice 没有启动')
        desktop = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
        doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(src), '_blank', 0, (prop('Hidden', True),))
        # 先排版，目录才能拿到页码；目录本身占的页数变了会影响页码，所以更新两遍
        for _ in range(2):
            indexes = doc.getDocumentIndexes()
            for i in range(indexes.getCount()):
                indexes.getByIndex(i).update()
            doc.refresh()
        doc.storeToURL(uno.systemPathToFileUrl(dst), (prop('FilterName', 'writer_pdf_Export'),))
        doc.close(True)
        try:
            desktop.terminate()
        except Exception:
            pass
    finally:
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()


main()
