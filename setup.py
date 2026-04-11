import setuptools
from pathlib import Path

package_files = Path("artie/web_app").glob("**/*")
package_files = [str(it).replace("artie/", "") for it in package_files]
package_files += ["model/anytext/ocr_recog/ppocr_keys_v1.txt"]
package_files += ["model/anytext/anytext_sd15.yaml"]
package_files += ["model/original_sd_configs/sd_xl_base.yaml"]
package_files += ["model/original_sd_configs/sd_xl_refiner.yaml"]
package_files += ["model/original_sd_configs/v1-inference.yaml"]
package_files += ["model/original_sd_configs/v2-inference-v.yaml"]


with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()


def load_requirements():
    requirements_file_name = "requirements.txt"
    requires = []
    with open(requirements_file_name) as f:
        for line in f:
            if line:
                requires.append(line.strip())
    return requires


# https://setuptools.readthedocs.io/en/latest/setuptools.html#including-data-files
setuptools.setup(
    name="Artie",
    version="1.6.0",
    author="",
    author_email="",
    description="Image inpainting, outpainting tool powered by SOTA AI Model",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/LyferLu/Artie",
    packages=setuptools.find_packages("."),
    package_data={"artie": package_files},
    install_requires=load_requirements(),
    python_requires=">=3.7",
    entry_points={"console_scripts": ["artie=artie:entry_point"]},
    classifiers=[
        "License :: OSI Approved :: Apache Software License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.7",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Topic :: Scientific/Engineering :: Artificial Intelligence",
    ],
)
