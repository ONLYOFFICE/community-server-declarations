using DocumentationUtility.Shared.Models.Abstract;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.Serialization;

namespace DocumentationUtility.Shared.Models
{
    public class DocApiType : DocCSharpItem
    {
        public List<DocApiProperty> Properties { get; protected set; } = new List<DocApiProperty>();
        public List<string> EnumValues { get; protected set; } = null;

        public DocApiType(Type type, List<string> parents = null, string forceName = null) : base(type)
        {
            this.type = type;

            if (forceName != null) Name = forceName;

            ParseXml();

            if (type.IsEnum)
            {
                this.type = typeof(int);
                Name = this.type.Name;
                var enumValues = new List<string>();
                foreach (var v in Enum.GetValues(type))
                {
                    enumValues.Add($"{(int)v} - {v}");
                }
                Description = $"[{string.Join(", ", enumValues)}]";
                EnumValues = Enum.GetNames(type).ToList();
            }
            else
            {
                if (Name.ToString().Contains("`"))
                {
                    var n = GetGenericType(this.type);
                    this.type = n.type;
                    Name = n.Name;
                }

                if (this.type.GetCustomAttributes(false).Where(a => a.GetType().Name == "TypeConverterAttribute").Count() != 0)
                {
                    this.type = typeof(string);
                    var i = Name.IndexOf('[');
                    Name = $"String{(i == -1 ? "" : Name.Substring(i, Name.Length))}";
                }
            }

            ParseProperties(parents);
        }

        private void ParseProperties(List<string> parents)
        {
            if (type.FullName.StartsWith("System."))
            {
                Properties = null;
                return;
            }
            foreach (var props in type.GetProperties())
            {
                if (props.GetCustomAttribute<DataMemberAttribute>() != null)
                {
                    Properties.Add(new DocApiProperty(this, props, parents));
                }
            }
        }

        private DocApiType GetGenericType(Type type)
        {
            string e = "[]";
            if (type.Name.Contains("Task")) e = "";

            DocApiType n;

            Type[] t = type.GetGenericArguments();

            switch (t.Length)
            {
                case 1:
                    {
                        if (t[0].Name.Contains("`"))
                        {
                            n = GetGenericType(t[0]);
                            n.Name += e;
                            return n;
                        }
                        n = new DocApiType(t[0]);
                        n.Name += e;
                        return n;
                    }
                case 2:
                    {
                        n = new DocApiType(typeof(object));
                        n.Name = $"<{t[0].Name}, {t[1].Name}>";
                        return n;
                    }
                default:
                    {
                        n = new DocApiType(typeof(object));
                        n.Name = "untracked_generic";
                        return n;
                    }
            }
        }

        private readonly Type type;
    }
}
