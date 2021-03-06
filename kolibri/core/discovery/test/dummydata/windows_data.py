import os

with open(os.path.join(os.path.dirname(__file__), "windows_wmic_output.csv")) as f:
    wmic_csv = f.read()

popen_responses = {
    "wmic logicaldisk list full /format:csv": wmic_csv,
}

os_access_read = {
    "C:\\": True,
    "D:\\": True,
    "E:\\": False,
}

os_access_write = {
    "C:\\": True,
    "D:\\": False,
    "E:\\": False,
}

has_kolibri_data_folder = {
    "C:\\": False,
    "D:\\": True,
    "E:\\": False,
}
